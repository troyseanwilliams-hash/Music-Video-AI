import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
  campaignInserts: [] as unknown[],
  recipientInserts: [] as unknown[],
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: mocks.db,
}));

import {
  emailCampaignRecipientsTable,
  emailCampaignsTable,
} from "@workspace/db";
import {
  GENERATE_VIDEO_CAMPAIGN_ID,
} from "../lib/emailTemplates.js";
import router from "./admin-email-campaigns.js";

type FakeResponse = {
  statusCode: number;
  body: unknown;
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

function queueHandler() {
  const layer = (router as any).stack.find(
    (candidate: any) =>
      candidate.route?.path === "/admin/email-campaigns/generate-video/queue" &&
      candidate.route?.methods?.post,
  );
  return layer.route.stack[0].handle as (req: any, res: FakeResponse) => Promise<void>;
}

function request(authenticated = true, origin = "https://app.example.test") {
  return {
    user: { email: "admin@example.test" },
    isAuthenticated: () => authenticated,
    get: (name: string) => {
      if (name.toLowerCase() === "origin") return origin;
      if (name.toLowerCase() === "host") return "app.example.test";
      return undefined;
    },
  };
}

function transactionWith(options?: { existingCampaign?: unknown[]; users?: Array<{ id: string; email: string }> }) {
  const tx = {
    select: vi.fn(() => {
      let table: unknown;
      const builder = {
        from(nextTable: unknown) {
          table = nextTable;
          return builder;
        },
        where() {
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit: vi.fn(async () => (
          table === emailCampaignsTable
            ? (options?.existingCampaign ?? [])
            : (options?.users ?? [])
        )),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(options?.users ?? []).then(resolve);
        },
      };
      return builder;
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (values: unknown) => {
        if (table === emailCampaignsTable) mocks.campaignInserts.push(values);
        if (table === emailCampaignRecipientsTable) mocks.recipientInserts.push(values);
      }),
    })),
  };
  mocks.db.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
  return tx;
}

describe("Generate Video campaign queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.campaignInserts.length = 0;
    mocks.recipientInserts.length = 0;
    process.env.ADMIN_EMAIL = "admin@example.test";
  });

  it("is restricted to the configured admin", async () => {
    const res = response();
    await queueHandler()(request(false), res);
    expect(res.statusCode).toBe(403);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests from a logged-in admin", async () => {
    const res = response();
    await queueHandler()(request(true, "https://malicious.example"), res);
    expect(res.statusCode).toBe(403);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("refuses to create the same campaign twice", async () => {
    transactionWith({
      existingCampaign: [{ id: GENERATE_VIDEO_CAMPAIGN_ID, status: "queued", nextRunAt: new Date() }],
    });
    const res = response();
    await queueHandler()(request(), res);
    expect(res.statusCode).toBe(409);
    expect(mocks.campaignInserts).toHaveLength(0);
    expect(mocks.recipientInserts).toHaveLength(0);
  });

  it("queues the newest 100 eligible users as one immutable cohort", async () => {
    const users = Array.from({ length: 100 }, (_, index) => ({
      id: `user-${index}`,
      email: `user-${index}@example.test`,
    }));
    transactionWith({ users });
    const res = response();
    await queueHandler()(request(), res);

    expect(res.statusCode).toBe(201);
    const rows = mocks.recipientInserts[0] as Array<{
      position: number;
      batchNumber: number;
      status: string;
      idempotencyKey: string;
    }>;
    expect(rows).toHaveLength(100);
    expect(rows[0]).toMatchObject({ position: 0, batchNumber: 0, status: "pending" });
    expect(rows[99]).toMatchObject({ position: 99, batchNumber: 0, status: "pending" });
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(100);
  });
});