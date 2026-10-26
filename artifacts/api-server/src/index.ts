import app from "./app.js";
import { logger } from "./lib/logger.js";
import {
  getJobProcessorStatus,
  startJobProcessor,
  stopJobProcessor,
} from "./lib/jobProcessor.js";
import { ensureAdminUser } from "./lib/ensureAdminUser.js";
import { initStripe } from "./lib/stripeClient.js";
import { replayRecentStripeEvents } from "./lib/webhookHandlers.js";
import { db, pool, usersTable, creditsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { startMediaRetentionSweep } from "./lib/mediaRetention.js";

async function fixAdminCredits(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  if (!email) return;
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user) return;
  // Never rewrite an existing balance at startup: that can erase a welcome
  // reservation, paid credits, or worker refunds when a process restarts.
  const created = await db.insert(creditsTable)
    .values({ id: randomUUID(), userId: user.id, creditsRemaining: 1475, subscriptionCredits: 10, topupCredits: 1465 })
    .onConflictDoNothing({ target: creditsTable.userId })
    .returning({ id: creditsTable.id });
  if (created.length) logger.info({ email, credits: 1475 }, "Admin credits provisioned");
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

const runProcessor =
  process.env.NODE_ENV !== "production" ||
  process.env.RUN_JOB_PROCESSOR === "true";
let shuttingDown = false;
const stopMediaRetentionSweep = startMediaRetentionSweep();

const server = app.listen(port, (err) => {
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
  if (runProcessor) {
    startJobProcessor().catch((err) => {
      logger.error({ err }, "Failed to start job processor");
    });
  } else {
    logger.info("Job processor disabled (handled by worker artifact in production)");
  }
});

function boundedTimeoutEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

// Bound slow or abusive connections so one API process can keep serving other
// users under burst traffic. Media uploads use direct object-storage URLs, so
// normal API requests should not need an unbounded socket lifetime.
server.requestTimeout = boundedTimeoutEnv(
  "API_REQUEST_TIMEOUT_MS",
  120_000,
  15_000,
  600_000,
);
server.headersTimeout = boundedTimeoutEnv(
  "API_HEADERS_TIMEOUT_MS",
  30_000,
  5_000,
  Math.min(server.requestTimeout, 120_000),
);
server.keepAliveTimeout = boundedTimeoutEnv(
  "API_KEEP_ALIVE_TIMEOUT_MS",
  5_000,
  1_000,
  60_000,
);
server.maxRequestsPerSocket = boundedTimeoutEnv(
  "API_MAX_REQUESTS_PER_SOCKET",
  1_000,
  100,
  10_000,
);

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "API shutdown requested — draining requests and job processor");

  const timeout = Number.parseInt(
    process.env.API_SHUTDOWN_TIMEOUT_MS ??
      process.env.WORKER_SHUTDOWN_TIMEOUT_MS ??
      "30000",
    10,
  );
  const boundedTimeout =
    Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 300_000) : 30_000;
  const forceExitTimer = setTimeout(() => {
    logger.error(
      { signal, processor: getJobProcessorStatus() },
      "API graceful shutdown exceeded hard deadline",
    );
    process.exit(1);
  }, boundedTimeout + 10_000);
  forceExitTimer.unref();

  const closeServer = new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
  });
  stopMediaRetentionSweep();
  const stopProcessor = runProcessor
    ? stopJobProcessor(boundedTimeout)
    : Promise.resolve({ drained: true, activeJobIds: [] as string[] });

  const [, processorResult] = await Promise.all([closeServer, stopProcessor]);
  if (!processorResult.drained) {
    logger.warn(
      { signal, activeJobIds: processorResult.activeJobIds },
      "API process stopped before active job completed; watchdog will recover it",
    );
  }
  await pool.end().catch((err: unknown) => {
    logger.warn({ err }, "Failed to close API database pool cleanly");
  });
  clearTimeout(forceExitTimer);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
