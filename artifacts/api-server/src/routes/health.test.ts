import { describe, expect, it } from "vitest";
import { buildReadinessResponse } from "./health.js";

const healthyProcessor = {
  workerId: "worker-a",
  state: "ready" as const,
  capacity: 1,
  activeJobs: 1,
  activeJobIds: ["job-1"],
  jobsStarted: 4,
  jobsCompleted: 3,
  jobsFailed: 0,
  startedAt: "2026-08-28T00:00:00.000Z",
  queue: {
    queued: 2,
    active: 1,
    oldestQueuedAt: "2026-08-28T00:00:00.000Z",
    oldestQueuedAgeMs: 10_000,
    database: "ok" as const,
  },
};

describe("service readiness", () => {
  it("reports embedded worker capacity and queue pressure when ready", () => {
    const result = buildReadinessResponse(
      healthyProcessor,
      true,
      123,
    );

    expect(result.ready).toBe(true);
    expect(result.body).toMatchObject({
      status: "ready",
      database: "ok",
      jobProcessor: {
        mode: "embedded",
        workerId: "worker-a",
        state: "ready",
        capacity: 1,
        activeJobs: 1,
        queuedJobs: 2,
        oldestQueuedAgeMs: 10_000,
      },
      ts: 123,
    });
  });

  it("fails readiness while an embedded worker is draining", () => {
    const result = buildReadinessResponse(
      { ...healthyProcessor, state: "draining" },
      true,
    );

    expect(result.ready).toBe(false);
    expect(result.body.status).toBe("not_ready");
  });

  it("fails readiness when the database cannot report queue state", () => {
    const result = buildReadinessResponse(
      {
        ...healthyProcessor,
        queue: { ...healthyProcessor.queue, database: "degraded" },
      },
      true,
    );

    expect(result.ready).toBe(false);
    expect(result.body.database).toBe("degraded");
  });

  it("does not require an in-process worker when capacity is external", () => {
    const result = buildReadinessResponse(
      { ...healthyProcessor, state: "stopped" },
      false,
    );

    expect(result.ready).toBe(true);
    expect(result.body.jobProcessor).toMatchObject({
      mode: "external",
      workerId: null,
      state: "external",
      capacity: 0,
      queuedJobs: 2,
    });
  });
});