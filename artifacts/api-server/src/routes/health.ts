import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getJobProcessorHealth } from "../lib/jobProcessor.js";

const router: IRouter = Router();

type ProcessorHealth = Awaited<ReturnType<typeof getJobProcessorHealth>>;

export function buildReadinessResponse(
  processor: ProcessorHealth,
  embeddedProcessor: boolean,
  now = Date.now(),
) {
  const processorReady =
    !embeddedProcessor || processor.state === "ready";
  const ready = processor.queue.database === "ok" && processorReady;
  return {
    ready,
    body: {
      status: ready ? "ready" : "not_ready",
      database: processor.queue.database,
      jobProcessor: {
        mode: embeddedProcessor ? "embedded" : "external",
        workerId: embeddedProcessor ? processor.workerId : null,
        state: embeddedProcessor ? processor.state : "external",
        capacity: embeddedProcessor ? processor.capacity : 0,
        activeJobs: processor.queue.active,
        queuedJobs: processor.queue.queued,
        oldestQueuedAt: processor.queue.oldestQueuedAt,
        oldestQueuedAgeMs: processor.queue.oldestQueuedAgeMs,
      },
      ts: now,
    },
  };
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  const processor = await getJobProcessorHealth();
  const embeddedProcessor =
    process.env.NODE_ENV !== "production" ||
    process.env.RUN_JOB_PROCESSOR === "true";
  const response = buildReadinessResponse(processor, embeddedProcessor);
  res.status(response.ready ? 200 : 503).json(response.body);
});

export default router;
