import http from "http";
import { startJobProcessor } from "./lib/jobProcessor";
import { logger } from "./lib/logger";

const port = Number(process.env.PORT ?? 9000);

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/worker/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", role: "job-worker", ts: Date.now() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(port, () => {
  logger.info({ port }, "Worker health server listening");

  startJobProcessor().catch((err) => {
    logger.error({ err }, "Job processor failed to start — exiting");
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received — shutting down gracefully");
  server.close(() => process.exit(0));
});
