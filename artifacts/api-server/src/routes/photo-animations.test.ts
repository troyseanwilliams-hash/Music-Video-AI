import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  executeResults: [] as Array<{ rows: unknown[] }>,
  inserted: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  transactionError: null as Error | null,
  metadata: { contentType: "image/png", size: "33" },
  buffer: Buffer.alloc(33),
  acl: true,
  uploads: [] as Array<{ jobId: string; contentType: string }>,
  db: null as any,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const resultBuilder = (rows: unknown[]) => {
    const builder: any = {
      from: () => builder,
      where: () => builder,
      limit: () => builder,
      for: async () => rows,
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  };
  const db: any = {
    select: vi.fn(() => resultBuilder(mocks.selectResults.shift() ?? [])),
    execute: vi.fn(async () => mocks.executeResults.shift() ?? { rows: [] }),
    insert: vi.fn((table: unknown) => {
      const builder: any = {
        values(values: Record<string, unknown>) {
          mocks.inserted.push({ table, values });
          return builder;
        },
        onConflictDoNothing: async () => undefined,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
      };
      return builder;
    }),
    update: vi.fn((table: unknown) => {
      const builder: any = {
        set(values: Record<string, unknown>) {
          mocks.updates.push({ table, values });
          return builder;
        },
        where: async () => undefined,
      };
      return builder;
    }),
    transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
      if (mocks.transactionError) throw mocks.transactionError;
      return callback(db);
    }),
  };
  mocks.db = db;
  return {
    ...(await importOriginal<typeof import("@workspace/db")>()),
    db,
  };
});

vi.mock("../lib/mediaUniqueness.js", () => ({
  perceptualFingerprint: vi.fn(async () => ({ exactHash: "ok", frames: [{}] })),
}));

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile() {
      return { getMetadata: async () => [mocks.metadata] };
    }
    async downloadObjectBuffer() {
      return mocks.buffer;
    }
    async canAccessObjectEntity() {
      return mocks.acl;
    }
    async uploadPhotoAnimationSourceBuffer(_buffer: Buffer, jobId: string, contentType: string) {
      mocks.uploads.push({ jobId, contentType });
      return `/objects/photo-animation-sources/${jobId}/source.png`;
    }
  },
}));

import router from "./photo-animations.js";
import { creditsTable, jobsTable } from "@workspace/db";

type FakeResponse = {
  statusCode: number;
  body: any;
  status(code: number): FakeResponse;
  json(body: unknown): FakeResponse;
};

function response(): FakeResponse {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function handler(path: string, method: "post" | "get" = "post") {
  const layer = (router as any).stack.find(
    (candidate: any) => candidate.route?.path === path && candidate.route?.methods?.[method],
  );
  return layer.route.stack[0].handle as (req: any, res: FakeResponse) => Promise<void>;
}

function request(body: Record<string, unknown>, authenticated = true) {
  return {
    body,
    user: { id: "11111111-1111-4111-8111-111111111111" },
    isAuthenticated: () => authenticated,
    log: { info: vi.fn(), error: vi.fn() },
  };
}

const assetSource = {
  kind: "asset",
  imageAssetId: "22222222-2222-4222-8222-222222222222",
} as const;
const common = {
  source: assetSource,
  prompt: "Slow camera push-in while the subject smiles",
  durationSeconds: 5,
  provider: "runway",
  resolution: "720p",
  aspectRatio: "16:9",
} as const;
const asset = { id: assetSource.imageAssetId, objectPath: "/objects/image-packs/job/0.png" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectResults.length = 0;
  mocks.executeResults.length = 0;
  mocks.inserted.length = 0;
  mocks.updates.length = 0;
  mocks.uploads.length = 0;
  mocks.transactionError = null;
  mocks.acl = true;
  mocks.buffer = Buffer.alloc(33);
  // Structurally valid 512x512 PNG; decoding itself is separately required and mocked.
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(mocks.buffer);
  mocks.buffer.writeUInt32BE(512, 16);
  mocks.buffer.writeUInt32BE(512, 20);
  mocks.metadata = { contentType: "image/png", size: String(mocks.buffer.length) };
  process.env.RUNWAY_API_KEY = "test-only";
  process.env.PIXAZO_API_KEY = "test-only";
});

describe("photo animation quote and submission", () => {
  it("requires authentication", async () => {
    const res = response();
    await handler("/photo-animations/quote")(request(common, false), res);
    expect(res.statusCode).toBe(401);
  });

  it("quotes without charging and returns the approval fingerprint", async () => {
    mocks.selectResults.push([asset]);
    const res = response();
    await handler("/photo-animations/quote")(request(common), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ imageCredits: 0, durationSeconds: 5, resolution: "720p" });
    expect(res.body.planFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
  });

  it.each([
    ["foreign or deleted asset", []],
    ["missing asset", []],
  ])("rejects a %s without charging", async (_name, rows) => {
    mocks.selectResults.push(rows);
    const res = response();
    await handler("/photo-animations/quote")(request(common), res);
    expect(res.statusCode).toBe(404);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("rejects an unavailable provider and unsupported premium resolution", async () => {
    delete process.env.RUNWAY_API_KEY;
    const unavailable = response();
    await handler("/photo-animations/quote")(request(common), unavailable);
    expect(unavailable.statusCode).toBe(503);

    const unsupported = response();
    await handler("/photo-animations/quote")(request({ ...common, resolution: "1080p" }), unsupported);
    expect(unsupported.statusCode).toBe(400);
  });

  it("requires storage ACL ownership for an uploaded source", async () => {
    mocks.acl = false;
    const res = response();
    await handler("/photo-animations/quote")(request({
      ...common,
      source: {
        kind: "upload",
        objectPath: `/objects/uploads/${request(common).user.id}/source.png`,
      },
    }), res);
    expect(res.statusCode).toBe(404);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("rejects unapproved and stale submissions before a debit", async () => {
    const unapproved = response();
    await handler("/photo-animations")(request({
      ...common,
      approved: false,
      expectedCredits: 1,
      planFingerprint: "a".repeat(64),
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    }), unapproved);
    expect(unapproved.statusCode).toBe(400);

    mocks.selectResults.push([asset]);
    const stale = response();
    await handler("/photo-animations")(request({
      ...common,
      approved: true,
      expectedCredits: 1,
      planFingerprint: "a".repeat(64),
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    }), stale);
    expect(stale.statusCode).toBe(409);
    expect(stale.body.code).toBe("STALE_PRICE");
    expect(mocks.inserted).toHaveLength(0);
  });

  it("queues one retained-source clip with an exact split reservation", async () => {
    mocks.selectResults.push([asset]);
    const quote = response();
    await handler("/photo-animations/quote")(request(common), quote);

    mocks.selectResults.push(
      [asset],
      [{ id: request(common).user.id, email: "user@test", subscriptionStatus: "active" }],
      [{ id: asset.id }],
      [{ creditsRemaining: 500, subscriptionCredits: 80, topupCredits: 420 }],
    );
    mocks.executeResults.push({ rows: [] });
    const submitted = response();
    await handler("/photo-animations")(request({
      ...common,
      approved: true,
      expectedCredits: quote.body.totalCredits,
      planFingerprint: quote.body.planFingerprint,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    }), submitted);

    expect(submitted.statusCode).toBe(201);
    const job = mocks.inserted.find((entry) => entry.table === jobsTable)!.values as any;
    expect(job.manifest.reservedSubscriptionCredits).toBe(80);
    expect(job.manifest.reservedTopupCredits).toBe(quote.body.totalCredits - 80);
    expect(job.manifest.photoAnimation).toMatchObject({
      approved: true,
      approvedPrompt: quote.body.prompt,
      durationSeconds: 5,
    });
    expect(job.manifest.storyboard.shots).toHaveLength(1);
    expect(job.manifest.storyboard.shots[0].prompt).toBe(quote.body.prompt);
    expect(job.referenceImagePath).toContain("/photo-animation-sources/");
    expect(mocks.updates.some((entry) => entry.table === creditsTable)).toBe(true);
  });

  it("returns the same job for an identical key and rejects changed payload", async () => {
    mocks.selectResults.push([asset]);
    const quote = response();
    await handler("/photo-animations/quote")(request(common), quote);
    const submission = {
      ...common,
      approved: true,
      expectedCredits: quote.body.totalCredits,
      planFingerprint: quote.body.planFingerprint,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    };

    mocks.selectResults.push(
      [asset],
      [{ id: request(common).user.id, email: "user@test", subscriptionStatus: "active" }],
    );
    mocks.executeResults.push({ rows: [{ id: "existing", status: "failed", requestHash: quote.body.planFingerprint }] });
    const same = response();
    await handler("/photo-animations")(request(submission), same);
    expect(same.statusCode).toBe(200);
    expect(same.body).toEqual({ id: "existing", status: "failed" });

    mocks.selectResults.push(
      [asset],
      [{ id: request(common).user.id, email: "user@test", subscriptionStatus: "active" }],
    );
    mocks.executeResults.push({ rows: [{ id: "existing", status: "failed", requestHash: "f".repeat(64) }] });
    const changed = response();
    await handler("/photo-animations")(request(submission), changed);
    expect(changed.statusCode).toBe(409);
    expect(changed.body.code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("does not expose transaction failures", async () => {
    mocks.selectResults.push([asset]);
    const quote = response();
    await handler("/photo-animations/quote")(request(common), quote);
    mocks.selectResults.push([asset]);
    mocks.transactionError = new Error("password=secret database exploded");
    const res = response();
    await handler("/photo-animations")(request({
      ...common,
      approved: true,
      expectedCredits: quote.body.totalCredits,
      planFingerprint: quote.body.planFingerprint,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    }), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
});

describe("GET /photo-animations/operations/:idempotencyKey", () => {
  const operationKey = "33333333-3333-4333-8333-333333333333";
  const operationHandler = () => handler(
    "/photo-animations/operations/:idempotencyKey",
    "get",
  );
  const lookupRequest = (authenticated = true) => ({
    ...request({}, authenticated),
    params: { idempotencyKey: operationKey },
  });

  it("requires authentication and validates the key without charging", async () => {
    const unauthorized = response();
    await operationHandler()(lookupRequest(false), unauthorized);
    expect(unauthorized.statusCode).toBe(401);

    const invalid = response();
    await operationHandler()({
      ...lookupRequest(),
      params: { idempotencyKey: "not-a-uuid" },
    }, invalid);
    expect(invalid.statusCode).toBe(400);
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
  });

  it("locks the authenticated user row and returns only their operation", async () => {
    mocks.selectResults.push([{ id: request(common).user.id }]);
    mocks.executeResults.push({ rows: [{ id: "pa_owned", status: "queued" }] });
    const res = response();
    await operationHandler()(lookupRequest(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: "pa_owned", status: "queued" });
    expect(mocks.db.transaction).toHaveBeenCalledOnce();
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
  });

  it("returns the ownership-safe missing contract without charging", async () => {
    mocks.selectResults.push([{ id: request(common).user.id }]);
    mocks.executeResults.push({ rows: [] });
    const res = response();
    await operationHandler()(lookupRequest(), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      code: "OPERATION_NOT_FOUND",
      error: "No photo animation operation was found for that key.",
    });
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
  });
});