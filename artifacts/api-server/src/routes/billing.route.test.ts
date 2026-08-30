import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
  stripe: {
    prices: {
      list: vi.fn(),
      retrieve: vi.fn(),
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
    customers: {
      retrieve: vi.fn(),
      create: vi.fn(),
    },
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
  },
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: mocks.db,
}));

vi.mock("../lib/stripeClient.js", () => ({
  getUncachableStripeClient: vi.fn(async () => mocks.stripe),
}));

import router from "./billing.js";
import { usersTable } from "@workspace/db";

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

function checkoutHandler() {
  const layer = (router as any).stack.find(
    (candidate: any) =>
      candidate.route?.path === "/billing/checkout" &&
      candidate.route?.methods?.post,
  );
  return layer.route.stack[0].handle as (req: any, res: FakeResponse) => Promise<void>;
}

function request(body: Record<string, unknown>) {
  return {
    body,
    user: { id: "user_1" },
    isAuthenticated: () => true,
    get: () => "example.test",
    protocol: "https",
    log: { warn: vi.fn(), error: vi.fn() },
  };
}

describe("POST /billing/checkout isolation", () => {
  const user = {
    id: "user_1",
    email: "user@example.test",
    firstName: "Test",
    lastName: "User",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    let reservationWon = false;

    mocks.db.select.mockImplementation(() => {
      let table: any;
      const builder = {
        from(nextTable: any) {
          table = nextTable;
          return builder;
        },
        where() {
          return builder;
        },
        async limit() {
          return table === usersTable ? [user] : [];
        },
      };
      return builder;
    });

    mocks.db.update.mockImplementation((table: any) => {
      const builder = {
        set() {
          return builder;
        },
        where() {
          return builder;
        },
        async returning() {
          if (table !== usersTable) return [];
          if (reservationWon) return [];
          reservationWon = true;
          return [{ id: user.id }];
        },
      };
      return builder;
    });

    mocks.stripe.prices.retrieve.mockResolvedValue({
      id: "price_pro",
      lookup_key: "pro_monthly",
      recurring: { interval: "month" },
    });
    mocks.stripe.prices.list.mockResolvedValue({
      data: [{ id: "price_pro" }],
    });
    mocks.stripe.customers.retrieve.mockResolvedValue({
      id: "cus_1",
      deleted: false,
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.test/session",
    });
  });

  it("rejects Suite lookup keys before accessing Stripe", async () => {
    const res = response();
    await checkoutHandler()(
      request({ lookupKey: "suite_creator_monthly" }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "PRICE_NOT_ALLOWED" });
    expect(mocks.stripe.prices.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rejects a Suite price ID after resolving its lookup key", async () => {
    mocks.stripe.prices.retrieve.mockResolvedValueOnce({
      id: "price_suite",
      lookup_key: "suite_creator_yearly",
      recurring: { interval: "year" },
    });
    const res = response();
    await checkoutHandler()(request({ priceId: "price_suite" }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "PRICE_NOT_ALLOWED" });
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("creates at most one Stripe session for concurrent direct checkout", async () => {
    const first = response();
    const second = response();
    await Promise.all([
      checkoutHandler()(request({ lookupKey: "pro_monthly" }), first),
      checkoutHandler()(request({ lookupKey: "pro_monthly" }), second),
    ]);

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
  });
});