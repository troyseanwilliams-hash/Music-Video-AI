import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
  },
  insertedRows: [] as unknown[],
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: mocks.db,
}));

import router from "./analytics.js";
import { analyticsEventsTable } from "@workspace/db";

type FakeResponse = {
  statusCode: number;
  status: (code: number) => FakeResponse;
  end: () => FakeResponse;
};

function response(): FakeResponse {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      return this;
    },
  };
}

function collectHandler() {
  const layer = (router as any).stack.find(
    (candidate: any) =>
      candidate.route?.path === "/analytics/collect" &&
      candidate.route?.methods?.post,
  );
  return layer.route.stack[0].handle as (req: any, res: FakeResponse) => Promise<void>;
}

describe("public analytics signup completion boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertedRows.length = 0;
    mocks.db.insert.mockImplementation((table: unknown) => ({
      values: vi.fn(async (rows: unknown) => {
        expect(table).toBe(analyticsEventsTable);
        mocks.insertedRows.push(...(Array.isArray(rows) ? rows : [rows]));
      }),
    }));
  });

  it("ignores spoofed signup completion while retaining other browser events", async () => {
    const res = response();
    await collectHandler()(
      {
        body: {
          events: [
            {
              type: "signup_completed",
              anonId: "attacker",
              meta: { source: "spoofed", category: "account_creation" },
            },
            {
              type: "signup_failed",
              anonId: "attacker",
              meta: { source: "spoofed", category: "persistence" },
            },
            {
              type: "pageview",
              path: "/register",
              anonId: "visitor-123",
            },
          ],
        },
        isAuthenticated: () => true,
        user: { id: "logged-in-user" },
        get: () => undefined,
        log: { warn: vi.fn() },
      },
      res,
    );

    expect(res.statusCode).toBe(204);
    expect(mocks.insertedRows).toHaveLength(1);
    expect(mocks.insertedRows[0]).toMatchObject({
      eventType: "pageview",
      userId: "logged-in-user",
    });
  });
});