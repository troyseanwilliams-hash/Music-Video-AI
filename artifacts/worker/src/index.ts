import http from "http";
import { fork, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { hostname } from "os";
import { pool } from "@workspace/db";
import {
  getJobProcessorHealth,
  startJobProcessor,
  stopJobProcessor,
} from "./lib/jobProcessor.js";
import { startDeletedVideoPurgeSweep } from "./lib/purgeSweep.js";
import { logger } from "./lib/logger.js";

const port = Number(process.env.PORT ?? 9000);
const isWorkerChild = process.env.WORKER_CHILD_PROCESS === "true";
const workerProcessCount = (() => {
  const parsed = Number.parseInt(process.env.WORKER_PROCESS_COUNT ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 8) : 1;
})();
const supervisorId =
  process.env.WORKER_ID?.trim() || `${hostname()}-${process.pid}`;
let shuttingDown = false;
const workerChildren = new Map<number, ChildProcess>();
const readyWorkerSlots = new Set<number>();
const restartAttempts = new Map<number, number>();
let stopPurgeSweep: (() => void) | null = null;

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function childWorkerId(slot: number): string {
  return `${supervisorId}-worker-${slot + 1}`;
}

function startWorkerChild(slot: number): void {
  if (shuttingDown || workerChildren.has(slot)) return;
  const child = fork(fileURLToPath(import.meta.url), [], {
    env: {
      ...process.env,
      WORKER_CHILD_PROCESS: "true",
      WORKER_ID: childWorkerId(slot),
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  workerChildren.set(slot, child);
  readyWorkerSlots.delete(slot);

  child.on("message", (message: unknown) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "ready"
    ) {
      readyWorkerSlots.add(slot);
      restartAttempts.set(slot, 0);
      logger.info(
        { slot, workerId: childWorkerId(slot), pid: child.pid },
        "Worker child ready",
      );
    }
  });

  child.once("exit", (code, signal) => {
    workerChildren.delete(slot);
    readyWorkerSlots.delete(slot);
    logger[shuttingDown ? "info" : "error"](
      { slot, workerId: childWorkerId(slot), pid: child.pid, code, signal },
      shuttingDown ? "Worker child stopped" : "Worker child exited unexpectedly",
    );
    if (!shuttingDown) {
      const attempts = (restartAttempts.get(slot) ?? 0) + 1;
      restartAttempts.set(slot, attempts);
      const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempts - 1, 5));
      const timer = setTimeout(() => startWorkerChild(slot), delayMs);
      timer.unref();
    }
  });
}

async function shutdownWorkerChild(signal: NodeJS.Signals): Promise<void> {
  logger.info(
    { signal, workerId: process.env.WORKER_ID },
    "Worker child shutdown requested",
  );
  const timeout = Number.parseInt(
    process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? "30000",
    10,
  );
  const result = await stopJobProcessor(timeout);
  if (!result.drained) {
    logger.warn(
      { signal, activeJobIds: result.activeJobIds },
      "Worker child stopped before active job completed; watchdog will recover it",
    );
  }
  await pool.end().catch((err: unknown) => {
    logger.warn({ err }, "Failed to close worker child database pool cleanly");
  });
  process.exit(0);
}

async function runWorkerChild(): Promise<void> {
  process.on("SIGTERM", () => void shutdownWorkerChild("SIGTERM"));
  process.on("SIGINT", () => void shutdownWorkerChild("SIGINT"));
  await startJobProcessor();
  process.send?.({
    type: "ready",
    workerId: process.env.WORKER_ID,
    pid: process.pid,
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/worker/health") {
    const healthyProcesses = readyWorkerSlots.size;
    sendJson(res, 200, {
      status: healthyProcesses === workerProcessCount ? "ok" : "starting",
      role: "job-worker-supervisor",
      supervisorId,
      acceptingJobs: healthyProcesses > 0 && !shuttingDown,
      capacity: {
        configuredProcesses: workerProcessCount,
        readyProcesses: healthyProcesses,
        perProcess: 1,
        total: workerProcessCount,
      },
      ts: Date.now(),
    });
    return;
  }

  if (req.url === "/ready" || req.url === "/worker/ready") {
    void getJobProcessorHealth()
      .then((processor) => {
        const healthyProcesses = readyWorkerSlots.size;
        const ready =
          healthyProcesses === workerProcessCount &&
          processor.queue.database === "ok" &&
          !shuttingDown;
        sendJson(res, ready ? 200 : 503, {
          status: ready ? "ready" : "not_ready",
          role: "job-worker-supervisor",
          supervisorId,
          acceptingJobs: ready,
          capacity: {
            configuredProcesses: workerProcessCount,
            readyProcesses: healthyProcesses,
            perProcess: 1,
            total: workerProcessCount,
          },
          queue: processor.queue,
          ts: Date.now(),
        });
      })
      .catch((err: unknown) => {
        logger.error({ err }, "Worker readiness check failed");
        sendJson(res, 503, {
          status: "not_ready",
          role: "job-worker-supervisor",
          supervisorId,
          acceptingJobs: false,
          ts: Date.now(),
        });
      });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

async function shutdownSupervisor(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(
    { signal, configuredProcesses: workerProcessCount },
    "Worker supervisor shutdown requested",
  );

  const timeout = Number.parseInt(
    process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? "30000",
    10,
  );
  const forceExitTimer = setTimeout(
    () => {
      logger.error(
        {
          signal,
          children: [...workerChildren.values()].map((child) => child.pid),
        },
        "Worker supervisor graceful shutdown exceeded hard deadline",
      );
      process.exit(1);
    },
    (Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000) + 10_000,
  );
  forceExitTimer.unref();

  stopPurgeSweep?.();
  stopPurgeSweep = null;
  const childExits = [...workerChildren.values()].map(
    (child) =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  );
  await Promise.all(childExits);

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
  });
  await pool.end().catch((err: unknown) => {
    logger.warn({ err }, "Failed to close worker database pool cleanly");
  });
  clearTimeout(forceExitTimer);
  process.exit(0);
}

if (isWorkerChild) {
  void runWorkerChild().catch((err: unknown) => {
    logger.error(
      { err, workerId: process.env.WORKER_ID },
      "Worker child failed to start",
    );
    process.exit(1);
  });
} else {
  server.listen(port, () => {
    logger.info(
      { port, supervisorId, workerProcessCount },
      "Worker supervisor health server listening",
    );
    for (let slot = 0; slot < workerProcessCount; slot++) {
      startWorkerChild(slot);
    }
    // Run maintenance once per supervisor, never once per worker child.
    stopPurgeSweep = startDeletedVideoPurgeSweep();
  });
  process.on("SIGTERM", () => void shutdownSupervisor("SIGTERM"));
  process.on("SIGINT", () => void shutdownSupervisor("SIGINT"));
}
