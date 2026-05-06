import app from "./app";
import { logger } from "./lib/logger";
import { startJobProcessor } from "./lib/jobProcessor";
import { ensureAdminUser } from "./lib/ensureAdminUser";
import { initStripe } from "./lib/stripeClient";
import { replayRecentStripeEvents } from "./lib/webhookHandlers";
import { db, usersTable, creditsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

async function fixAdminCredits(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  if (!email) return;
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user) return;
  const [existing] = await db.select({ creditsRemaining: creditsTable.creditsRemaining }).from(creditsTable).where(eq(creditsTable.userId, user.id)).limit(1);
  if (existing?.creditsRemaining === 1475) return;
  await db.insert(creditsTable).values({ id: randomUUID(), userId: user.id, creditsRemaining: 1475, subscriptionCredits: 10, topupCredits: 1465 })
    .onConflictDoUpdate({ target: creditsTable.userId, set: { creditsRemaining: 1475, subscriptionCredits: 10, topupCredits: 1465 } });
  logger.info({ email, credits: 1475 }, "Admin credits fixed on startup");
}

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

  fixAdminCredits().catch((err) => {
    logger.error({ err }, "Failed to fix admin credits");
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
