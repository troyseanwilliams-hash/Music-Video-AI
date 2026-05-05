import app from "./app";
import { logger } from "./lib/logger";
import { startJobProcessor } from "./lib/jobProcessor";
import { ensureAdminUser } from "./lib/ensureAdminUser";
import { initStripe } from "./lib/stripeClient";
import { replayRecentStripeEvents } from "./lib/webhookHandlers";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  ensureAdminUser().catch((err) => {
    logger.error({ err }, "Failed to ensure admin user");
  });

  const rawLookback = process.env["STRIPE_REPLAY_LOOKBACK_SECONDS"];
  let replayLookbackSeconds = 1800;
  if (rawLookback !== undefined && rawLookback !== "") {
    const parsed = parseInt(rawLookback, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      logger.warn(
        { rawLookback },
        "STRIPE_REPLAY_LOOKBACK_SECONDS is not a valid positive integer — defaulting to 1800",
      );
    } else {
      replayLookbackSeconds = parsed;
    }
  }

  initStripe()
    .then(() => {
      // Replay recent Stripe events to recover any credit grants that were
      // delivered to Stripe while the server was restarting.  The lookback
      // window defaults to 30 minutes (1800 s) but can be extended via the
      // STRIPE_REPLAY_LOOKBACK_SECONDS environment variable for longer
      // outages (e.g. deployments or scheduled maintenance).
      // All handlers are idempotent via unique DB constraints, so
      // re-processing an already-handled event is always a safe no-op.
      return replayRecentStripeEvents(replayLookbackSeconds);
    })
    .catch((err) => {
      logger.error({ err }, "Failed to initialize Stripe or replay events");
    });

  // In production the dedicated worker artifact runs the job processor.
  // In development (or when explicitly opted in) run it here too.
  const runProcessor =
    process.env.NODE_ENV !== "production" ||
    process.env.RUN_JOB_PROCESSOR === "true";
  if (runProcessor) {
    startJobProcessor().catch((err) => {
      logger.error({ err }, "Failed to start job processor");
    });
  } else {
    logger.info("Job processor disabled (handled by worker artifact in production)");
  }
});
