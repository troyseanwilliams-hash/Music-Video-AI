import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  tx: {
    execute: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  stripe: {
    subscriptions: {
      retrieve: vi.fn(),
    },
  },
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: mocks.db,
}));

vi.mock("./stripeClient.js", () => ({
  getUncachableStripeClient: vi.fn(async () => mocks.stripe),
  getStripeSync: vi.fn(),
}));

import { handleSubscriptionUpdated } from "./webhookHandlers.js";

describe("subscription lifecycle authority fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.transaction.mockImplementation(async (callback: any) =>
      callback(mocks.tx),
    );
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
          if (table?.stripeCustomerId) {
            return [
              {
                id: "user_1",
                stripeCustomerId: "cus_1",
                stripeSubscriptionId: "sub_suite_new",
              },
            ];
          }
          if (table?.aibeatUserId) {
            return [
              {
                subscriptionStatus: "active",
                stripeSubscriptionId: "sub_suite_new",
              },
            ];
          }
          return [];
        },
      };
      return builder;
    });
  });

  it("preserves active Suite status and credits when an old direct cancellation arrives late", async () => {
    const delayedDirectCancellation = {
      id: "sub_direct_old",
      customer: "cus_1",
      status: "canceled",
      metadata: { userId: "user_1" },
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: {
              id: "price_pro",
              lookup_key: "pro_monthly",
              metadata: { credits: "2500" },
            },
          },
        ],
      },
    } as unknown as Stripe.Subscription;
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(
      delayedDirectCancellation,
    );

    await handleSubscriptionUpdated(
      "evt_delayed_direct_cancel",
      delayedDirectCancellation,
    );

    expect(mocks.db.update).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("does not resurrect an old direct plan from a delayed active snapshot after Suite cancellation", async () => {
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
          if (table?.stripeCustomerId) {
            return [
              {
                id: "user_1",
                stripeCustomerId: "cus_1",
                stripeSubscriptionId: "sub_suite_ended",
              },
            ];
          }
          if (table?.aibeatUserId) {
            return [
              {
                subscriptionStatus: "cancelled",
                stripeSubscriptionId: "sub_suite_ended",
              },
            ];
          }
          return [];
        },
      };
      return builder;
    });
    const delayedActiveSnapshot = {
      id: "sub_direct_old",
      customer: "cus_1",
      status: "active",
      metadata: { userId: "user_1" },
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: {
              id: "price_pro",
              lookup_key: "pro_monthly",
              metadata: { credits: "2500" },
            },
          },
        ],
      },
    } as unknown as Stripe.Subscription;
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce({
      ...delayedActiveSnapshot,
      status: "canceled",
    });

    await handleSubscriptionUpdated(
      "evt_delayed_direct_active",
      delayedActiveSnapshot,
    );

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
      "sub_direct_old",
    );
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("preserves a new direct plan when an old Suite deletion arrives late", async () => {
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
          if (table?.stripeCustomerId) {
            return [
              {
                id: "user_1",
                stripeCustomerId: "cus_1",
                stripeSubscriptionId: "sub_direct_new",
              },
            ];
          }
          return [];
        },
      };
      return builder;
    });
    mocks.tx.select.mockImplementation(() => {
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
          if (table?.stripeCustomerId) {
            return [{ stripeSubscriptionId: "sub_direct_new" }];
          }
          if (table?.aibeatUserId) {
            return [
              {
                id: "link_1",
                subscriptionStatus: "cancelled",
                stripeSubscriptionId: "sub_suite_old",
              },
            ];
          }
          return [];
        },
      };
      return builder;
    });

    const delayedSuiteDeletion = {
      id: "sub_suite_old",
      customer: "cus_1",
      status: "canceled",
      metadata: { userId: "user_1", linkId: "link_1" },
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: {
              id: "price_suite_creator",
              lookup_key: "suite_creator_monthly",
              metadata: { credits: "1000", aipodCredits: "200" },
            },
          },
        ],
      },
    } as unknown as Stripe.Subscription;
    mocks.stripe.subscriptions.retrieve.mockImplementation(async (id: string) => {
      if (id === "sub_suite_old") return delayedSuiteDeletion;
      return {
        id: "sub_direct_new",
        status: "active",
        items: { data: [] },
        metadata: {},
      };
    });

    await handleSubscriptionUpdated(
      "evt_delayed_suite_delete",
      delayedSuiteDeletion,
    );

    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.insert).not.toHaveBeenCalled();
    expect(mocks.tx.update).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });
});