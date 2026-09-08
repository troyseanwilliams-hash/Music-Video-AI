import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
  updatedTables: [] as unknown[],
  updateSet: null as Record<string, unknown> | null,
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: mocks.db,
}));

import { creditsTable, jobsTable } from "@workspace/db";
import router from "./admin-jobs.js";

type FakeResponse = {
  statusCode: number;
  body: any;
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
};

function response(): FakeResponse {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function request(id = "job-1") {
  return {
    params: { id },
    user: { email: "admin@example.test" },
    isAuthenticated: () => true,
    log: { info: vi.fn() },
  };
}

function resumeHandler() {
  const layer = (router as any).stack.find(
    (candidate: any) =>
      candidate.route?.path === "/admin/jobs/:id/resume-recovery" &&
      candidate.route?.methods?.post,
  );
  return layer.route.stack[0].handle as (
    req: ReturnType<typeof request>,
    res: FakeResponse,
  ) => Promise<void>;
}

function completeManifest(extra: Record<string, unknown> = {}) {
  return {
    refunded: true,
    storyboard: { numClips: 2 },
    partialClips: {
      "0": "/objects/clips/job-1/0.mp4",
      "1": "/objects/clips/job-1/1.mp4",
    },
    ...extra,
  };
}

function transactionFor(job: Record<string, unknown>) {
  const selectBuilder = {
    from: vi.fn(() => selectBuilder),
    where: vi.fn(() => selectBuilder),
    limit: vi.fn(() => selectBuilder),
    for: vi.fn(async () => [job]),
  };
  const updateBuilder = {
    set: vi.fn((value: Record<string, unknown>) => {
      mocks.updateSet = value;
      return updateBuilder;
    }),
    where: vi.fn(() => updateBuilder),
    returning: vi.fn(async () => [{
      ...job,
      status: "queued",
      claimedAt: null,
    }]),
  };
  const tx = {
    select: vi.fn(() => selectBuilder),
    update: vi.fn((table: unknown) => {
      mocks.updatedTables.push(table);
      return updateBuilder;
    }),
    insert: vi.fn(),
    delete: vi.fn(),
  };
  mocks.db.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) =>
    callback(tx)
  );
  return tx;
}

function containsPrimitive(value: unknown, expected: unknown, seen = new Set<unknown>()): boolean {
  if (value === expected) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((entry) => containsPrimitive(entry, expected, seen));
}

describe("POST /admin/jobs/:id/resume-recovery complete saved clips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updatedTables.length = 0;
    mocks.updateSet = null;
    process.env.ADMIN_EMAIL = "admin@example.test";
  });

  it.each(["analyzing", "failed"])(
    "requeues a refunded %s AI job with a complete clip set without touching credits",
    async (status) => {
      const tx = transactionFor({
        id: "job-1",
        jobType: "ai",
        status,
        manifest: completeManifest(),
      });
      const res = response();

      await resumeHandler()(request(), res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        completeSavedClipRecovery: true,
        savedRequestCount: 0,
        job: { status: "queued", claimedAt: null },
      });
      expect(mocks.updateSet).toMatchObject({
        status: "queued",
        errorMessage: null,
        retryCount: 0,
        claimedAt: null,
      });
      expect(containsPrimitive(mocks.updateSet?.manifest, true)).toBe(true);
      expect(tx.insert).not.toHaveBeenCalled();
      expect(tx.delete).not.toHaveBeenCalled();
      expect(mocks.updatedTables).toEqual([jobsTable]);
      expect(mocks.updatedTables).not.toContain(creditsTable);
    },
  );

  it("rejects a queued job even when its saved clip set is complete", async () => {
    const tx = transactionFor({
      id: "job-1",
      jobType: "ai",
      status: "queued",
      manifest: completeManifest(),
    });
    const res = response();

    await resumeHandler()(request(), res);

    expect(res.statusCode).toBe(400);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("fails closed when the recovery flag exists but the saved clip set is incomplete", async () => {
    const tx = transactionFor({
      id: "job-1",
      jobType: "ai",
      status: "analyzing",
      manifest: {
        completeSavedClipRecovery: true,
        refunded: true,
        storyboard: { numClips: 2 },
        partialClips: { "0": "/objects/clips/job-1/0.mp4" },
      },
    });
    const res = response();

    await resumeHandler()(request(), res);

    expect(res.statusCode).toBe(409);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it.each([
    ["uncertain submission", { uncertainSubmissions: { "2": { provider: "runway" } } }],
    ["submission intent", { submissionIntents: { "2": { provider: "runway" } } }],
    ["rejected request", { rejectedRequests: { "2": { reason: "failed" } } }],
  ])("rejects complete clips with a persisted %s", async (_label, unsafeState) => {
    const tx = transactionFor({
      id: "job-1",
      jobType: "ai",
      status: "failed",
      manifest: completeManifest(unsafeState),
    });
    const res = response();

    await resumeHandler()(request(), res);

    expect(res.statusCode).toBe(409);
    expect(tx.update).not.toHaveBeenCalled();
  });
});