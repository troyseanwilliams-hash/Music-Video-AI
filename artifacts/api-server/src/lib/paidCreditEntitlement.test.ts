import { describe, expect, it } from "vitest";
import {
  canCreateCreditFundedMediaWithPurchases,
  hasPurchasedTopupCredits,
} from "./paidCreditEntitlement.js";

// Fake executor: each select() consumes the next queued result set, and the
// chain records how many queries ran.
function fakeExecutor(results: unknown[][]) {
  const queue = [...results];
  let calls = 0;
  const exec = {
    select: () => {
      calls += 1;
      const rows = queue.shift() ?? [];
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = () => Promise.resolve(rows);
      return chain;
    },
  };
  return { exec: exec as never, calls: () => calls };
}

const now = Date.parse("2026-01-10T00:00:00Z");
const expiredTrialUser = {
  id: "u1",
  subscriptionStatus: "trial",
  trialEndsAt: new Date(now - 1000),
};

describe("hasPurchasedTopupCredits", () => {
  it("is true only with a positive top-up balance AND a real top-up purchase", async () => {
    const { exec } = fakeExecutor([[{ topupCredits: 250 }], [{ id: "grant-1" }]]);
    expect(await hasPurchasedTopupCredits(exec, "u1")).toBe(true);
  });

  it("is false when the top-up balance is empty (nothing to spend)", async () => {
    const { exec, calls } = fakeExecutor([[]]);
    expect(await hasPurchasedTopupCredits(exec, "u1")).toBe(false);
    expect(calls()).toBe(1); // no need to look for a purchase
  });

  it("is false when top-up credits came from referral/admin rather than a purchase", async () => {
    const { exec } = fakeExecutor([[{ topupCredits: 500 }], []]);
    expect(await hasPurchasedTopupCredits(exec, "u1")).toBe(false);
  });
});

describe("canCreateCreditFundedMediaWithPurchases", () => {
  it("lets a top-up buyer generate after the trial expired, with no subscription", async () => {
    const { exec } = fakeExecutor([[{ topupCredits: 1000 }], [{ id: "g" }]]);
    expect(await canCreateCreditFundedMediaWithPurchases(exec, expiredTrialUser, now)).toBe(true);
  });

  it("lets a top-up buyer with status 'none' generate", async () => {
    const { exec } = fakeExecutor([[{ topupCredits: 250 }], [{ id: "g" }]]);
    expect(
      await canCreateCreditFundedMediaWithPurchases(exec, { id: "u1", subscriptionStatus: "none" }, now),
    ).toBe(true);
  });

  it("still blocks an expired trial that never bought credits", async () => {
    const { exec } = fakeExecutor([[]]);
    expect(await canCreateCreditFundedMediaWithPurchases(exec, expiredTrialUser, now)).toBe(false);
  });

  it("does not query the database when the user already qualifies", async () => {
    const { exec, calls } = fakeExecutor([]);
    expect(
      await canCreateCreditFundedMediaWithPurchases(exec, { id: "u1", subscriptionStatus: "active" }, now),
    ).toBe(true);
    expect(
      await canCreateCreditFundedMediaWithPurchases(
        exec,
        { id: "u1", subscriptionStatus: "trial", trialEndsAt: new Date(now + 1000) },
        now,
      ),
    ).toBe(true);
    expect(calls()).toBe(0);
  });

  it("denies a missing user or a user without an id", async () => {
    const { exec, calls } = fakeExecutor([]);
    expect(await canCreateCreditFundedMediaWithPurchases(exec, null, now)).toBe(false);
    expect(await canCreateCreditFundedMediaWithPurchases(exec, undefined, now)).toBe(false);
    expect(await canCreateCreditFundedMediaWithPurchases(exec, { subscriptionStatus: "none" }, now)).toBe(false);
    expect(calls()).toBe(0);
  });
});
