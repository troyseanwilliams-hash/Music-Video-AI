import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
  tx: {
    execute: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  stripe: {
    prices: {
      retrieve: vi.fn(),
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  },
  notifyPayment: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: mocks.db,
}));

vi.mock("./stripeClient.js", () => ({
  getUncachableStripeClient: vi.fn(async () => mocks.stripe),
  getStripeSync: vi.fn(),
}));

vi.mock("./notifications.js", () => ({
  notifyPayment: mocks.notifyPayment,
}));

import { handleInvoicePaid } from "./webhookHandlers.js";

function selectBuilder(rows: unknown[]) {
  const builder = {
    from() {
      return builder;
    },
    where() {
      return builder;
    },
    async limit() {
      return rows;
    },
  };
  return builder;
}

function invoice(
  lookupKey: string,
  metadata: Record<string, string>,
  subscriptionId: string,
): Stripe.Invoice {
  return {
    id: `inv_${subscriptionId}`,
    customer: "cus_1",
    subscription: subscriptionId,
    amount_paid: 1000,
    lines: {
      data: [
        {
          id: "il_1",
          type: "subscription",
          proration: false,
          quantity: 1,
          price: {
            id: `price_${lookupKey}`,
            lookup_key: lookupKey,
            metadata,
          },
        },
      ],
    },
  } as unknown as Stripe.Invoice;
}

function event(invoiceValue: Stripe.Invoice): Stripe.Event {
  return {
    id: `evt_${invoiceValue.id}`,
    type: "invoice.paid",
    data: { object: invoiceValue },
  } as Stripe.Event;
}

describe("invoice authority fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockImplementation(() =>
      selectBuilder([
        {
          id: "user_1",
          email: "user@example.test",
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_suite_new",
          subscriptionStatus: "active",
        },
      ]),
    );
    mocks.db.transaction.mockImplementation(async (callback: any) =>
      callback(mocks.tx),
    );
  });

  it("ignores a delayed paid invoice from an old canceled direct subscription", async () => {
    const oldInvoice = invoice(
      "pro_monthly",
      { credits: "2500" },
      "sub_direct_old",
    );
    mocks.stripe.prices.retrieve.mockResolvedValue({
      id: "price_pro_monthly",
      lookup_key: "pro_monthly",
      metadata: { credits: "2500" },
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_direct_old",
      status: "canceled",
      metadata: {},
    });

    await handleInvoicePaid(event(oldInvoice), oldInvoice);

    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.notifyPayment).not.toHaveBeenCalled();
  });

  it("ignores an older Suite invoice when a newer Suite subscription owns the link", async () => {
    const oldInvoice = invoice(
      "suite_creator_monthly",
      { credits: "1000", aipodCredits: "200" },
      "sub_suite_old",
    );
    mocks.stripe.prices.retrieve.mockResolvedValue({
      id: "price_suite_creator_monthly",
      lookup_key: "suite_creator_monthly",
      metadata: { credits: "1000", aipodCredits: "200" },
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_suite_old",
      status: "active",
      metadata: { linkId: "link_1" },
    });
    mocks.tx.select.mockImplementation(() =>
      selectBuilder([
        {
          id: "link_1",
          subscriptionStatus: "active",
          stripeSubscriptionId: "sub_suite_new",
        },
      ]),
    );

    await handleInvoicePaid(event(oldInvoice), oldInvoice);

    expect(mocks.tx.execute).toHaveBeenCalledTimes(1);
    expect(mocks.tx.insert).not.toHaveBeenCalled();
    expect(mocks.tx.update).not.toHaveBeenCalled();
    expect(mocks.notifyPayment).not.toHaveBeenCalled();
  });
});