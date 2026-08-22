import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { resolveSubscriptionId } from "./webhookHandlers.js";

describe("resolveSubscriptionId", () => {
  it("reads the modern invoice parent shape", () => {
    const invoice = {
      parent: {
        subscription_details: {
          subscription: "sub_modern",
        },
      },
    } as unknown as Stripe.Invoice;

    expect(resolveSubscriptionId(invoice)).toBe("sub_modern");
  });

  it("reads an expanded modern subscription", () => {
    const invoice = {
      parent: {
        subscription_details: {
          subscription: { id: "sub_expanded" },
        },
      },
    } as unknown as Stripe.Invoice;

    expect(resolveSubscriptionId(invoice)).toBe("sub_expanded");
  });

  it("falls back to the legacy top-level shape", () => {
    const invoice = {
      subscription: "sub_legacy",
    } as unknown as Stripe.Invoice;

    expect(resolveSubscriptionId(invoice)).toBe("sub_legacy");
  });

  it("returns null when an invoice is not subscription-backed", () => {
    expect(resolveSubscriptionId({} as Stripe.Invoice)).toBeNull();
  });
});