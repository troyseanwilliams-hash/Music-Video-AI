import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import type { Stripe as StripeType } from "stripe";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  sync: {
    getAccountId: vi.fn(),
    postgresClient: { query: vi.fn() },
    stripe: {
      webhooks: {
        constructEventAsync: vi.fn(),
      },
    },
    processEvent: vi.fn(),
  },
  getStripeSync: vi.fn(),
  stripe: {
    checkout: { sessions: { retrieve: vi.fn() } },
    events: { list: vi.fn() },
  },
  notifyPayment: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: mocks.db,
}));

vi.mock("./stripeClient.js", () => ({
  getStripeSync: mocks.getStripeSync,
  getUncachableStripeClient: vi.fn(async () => mocks.stripe),
}));

vi.mock("./notifications.js", () => ({
  notifyPayment: mocks.notifyPayment,
}));

vi.mock("./logger.js", () => ({
  logger: mocks.logger,
}));

vi.mock("./suiteStripeClient.js", () => ({
  getSuiteStripeClient: vi.fn(),
  getSuiteWebhookSecret: vi.fn(),
}));

import {
  handleCheckoutCompleted,
  isInvalidStripeSignatureError,
  replayRecentStripeEvents,
  WebhookHandlers,
} from "./webhookHandlers.js";

const webhookSecret = "whsec_regression_test";

function signedPayload(event: Record<string, unknown>): {
  payload: Buffer;
  signature: string;
} {
  const payload = JSON.stringify(event);
  const signer = new Stripe("sk_test_regression");
  return {
    payload: Buffer.from(payload),
    signature: signer.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    }),
  };
}

describe("Stripe webhook verification and preview handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStripeSync.mockResolvedValue(mocks.sync);
    mocks.sync.getAccountId.mockResolvedValue("acct_regression");
    mocks.sync.postgresClient.query.mockResolvedValue({
      rows: [{ secret: webhookSecret }],
    });
    mocks.sync.stripe.webhooks.constructEventAsync.mockImplementation(
      async (payload: Buffer, signature: string, secret: string) => {
        const verifier = new Stripe("sk_test_regression");
        return verifier.webhooks.constructEventAsync(
          payload,
          signature,
          secret,
        );
      },
    );
  });

  it("verifies a signed upcoming preview before skipping sync persistence", async () => {
    const { payload, signature } = signedPayload({
      id: "evt_upcoming_preview",
      object: "event",
      type: "invoice.upcoming",
      data: {
        object: {
          object: "invoice",
          id: null,
          customer: "cus_preview",
        },
      },
    });

    await WebhookHandlers.processWebhook(payload, signature);

    expect(mocks.sync.stripe.webhooks.constructEventAsync).toHaveBeenCalledWith(
      payload,
      signature,
      webhookSecret,
    );
    expect(mocks.sync.processEvent).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("does not skip an upcoming event that has an invoice ID", async () => {
    const { payload, signature } = signedPayload({
      id: "evt_upcoming_with_id",
      object: "event",
      type: "invoice.upcoming",
      data: {
        object: {
          object: "invoice",
          id: "in_upcoming_1",
          customer: "cus_upcoming",
        },
      },
    });

    await WebhookHandlers.processWebhook(payload, signature);

    expect(mocks.sync.processEvent).toHaveBeenCalledTimes(1);
  });

  it("does not skip an ID-less event when it is not invoice.upcoming", async () => {
    const { payload, signature } = signedPayload({
      id: "evt_customer_without_id",
      object: "event",
      type: "customer.created",
      data: {
        object: {
          object: "customer",
          id: null,
        },
      },
    });

    await WebhookHandlers.processWebhook(payload, signature);

    expect(mocks.sync.processEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid signature without considering the JSON event", async () => {
    const payload = Buffer.from(
      JSON.stringify({
        id: "evt_unsigned_preview",
        object: "event",
        type: "invoice.upcoming",
        data: { object: { object: "invoice", id: null } },
      }),
    );

    await expect(
      WebhookHandlers.processWebhook(payload, "t=1,v1=not-valid"),
    ).rejects.toBeInstanceOf(Stripe.errors.StripeSignatureVerificationError);
    expect(mocks.sync.processEvent).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("propagates a custom billing failure after sync processing", async () => {
    const { payload, signature } = signedPayload({
      id: "evt_custom_failure",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_custom_failure",
          object: "checkout.session",
          mode: "payment",
          customer: "cus_custom_failure",
        },
      },
    });

    await expect(
      WebhookHandlers.processWebhook(payload, signature),
    ).rejects.toThrow();
    expect(mocks.sync.processEvent).toHaveBeenCalledTimes(1);
  });

  it("identifies signature failures separately from retryable internal failures", () => {
    const signatureError = new Error("bad signature");
    signatureError.name = "StripeSignatureVerificationError";

    expect(isInvalidStripeSignatureError(signatureError)).toBe(true);
    expect(isInvalidStripeSignatureError(new Error("database unavailable"))).toBe(
      false,
    );
  });

  it("counts event listing failures instead of reporting a false replay success", async () => {
    mocks.stripe.events.list.mockImplementation(() => {
      throw new Error("Stripe events unavailable");
    });

    await replayRecentStripeEvents(60);

    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 7, total: 0 }),
      "Stripe event replay finished with errors — some credits may need manual review",
    );
    expect(mocks.logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ total: 0 }),
      "Stripe event replay complete",
    );
  });
});

describe("credit grant idempotency across webhook redelivery", () => {
  let topupGrantInsertCount = 0;
  let grantExists = false;
  let failBalanceUpdateOnce = false;
  let balanceIncreaseCount = 0;

  beforeEach(() => {
    vi.clearAllMocks();

    grantExists = false;
    failBalanceUpdateOnce = true;
    balanceIncreaseCount = 0;
    topupGrantInsertCount = 0;
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
                email: "user@example.test",
                stripeCustomerId: "cus_1",
              },
            ];
          }
          if (table?.stripeCheckoutSessionId && grantExists) {
            return [{ id: "grant_1" }];
          }
          return [];
        },
      };
      return builder;
    });

    mocks.db.transaction.mockImplementation(async (callback: any) => {
      let grantInsertedInTransaction = false;
      const tx = {
        insert() {
          const builder = {
            values(values: Record<string, unknown>) {
              if (values.source === "topup") {
                grantInsertedInTransaction = true;
                topupGrantInsertCount += 1;
              }
              return builder;
            },
            onConflictDoNothing() {
              return builder;
            },
            async returning() {
              return grantInsertedInTransaction && !grantExists
                ? [{ id: "grant_1" }]
                : [];
            },
          };
          return builder;
        },
        update() {
          return {
            set() {
              return {
                async where() {
                  if (failBalanceUpdateOnce) {
                    failBalanceUpdateOnce = false;
                    throw new Error("balance update unavailable");
                  }
                  balanceIncreaseCount += 100;
                },
              };
            },
          };
        },
      };

      // Commit the marker only after the callback completes. A thrown balance
      // update therefore models the real database transaction rollback.
      const result = await callback(tx);
      if (grantInsertedInTransaction) grantExists = true;
      return result;
    });
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_topup_1",
      amount_total: 1000,
      line_items: {
        data: [
          {
            quantity: 1,
            price: {
              id: "price_topup",
              metadata: { credits: "100" },
            },
          },
        ],
      },
    });
  });

  it("rolls back a failed grant and applies it once on redelivery", async () => {
    const session = {
      id: "cs_topup_1",
      mode: "payment",
      customer: "cus_1",
    } as unknown as StripeType.Checkout.Session;
    const event = {
      id: "evt_topup_1",
      type: "checkout.session.completed",
      data: { object: session },
    } as unknown as StripeType.Event;

    await expect(
      handleCheckoutCompleted(
        event,
        session,
        mocks.stripe as unknown as StripeType,
      ),
    ).rejects.toThrow("balance update unavailable");
    expect(grantExists).toBe(false);

    await handleCheckoutCompleted(
      event,
      session,
      mocks.stripe as unknown as StripeType,
    );

    expect(topupGrantInsertCount).toBe(2);
    expect(balanceIncreaseCount).toBe(100);
    expect(grantExists).toBe(true);
  });
});