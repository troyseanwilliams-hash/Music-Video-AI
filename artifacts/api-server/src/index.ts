import app from "./app";
import { logger } from "./lib/logger";
import { startJobProcessor } from "./lib/jobProcessor";
import { ensureAdminUser } from "./lib/ensureAdminUser";

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
