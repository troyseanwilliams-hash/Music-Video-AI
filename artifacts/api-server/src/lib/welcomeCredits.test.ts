import { describe, expect, it } from "vitest";
import { creditsTable, activeWelcomeRefund, lockActiveCredits, splitCreditDebit, welcomeGrantActive } from "@workspace/db";

describe("seven-day welcome credit grant", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const sevenDays = new Date("2026-01-08T00:00:00.000Z");

  it("is available up to, but not including, the 7-day boundary", () => {
    const owner = { createdAt, trialEndsAt: sevenDays };
    expect(welcomeGrantActive(owner, new Date(sevenDays.getTime() - 1))).toBe(true);
    expect(welcomeGrantActive(owner, sevenDays)).toBe(false);
    expect(welcomeGrantActive(owner, new Date(sevenDays.getTime() + 1))).toBe(false);
  });

  it("does not extend when a paid bundle or promotional trial extends trialEndsAt", () => {
    const owner = { createdAt, trialEndsAt: new Date("2027-01-01T00:00:00.000Z") };
    expect(welcomeGrantActive(owner, sevenDays)).toBe(false);
  });

  it("honors an earlier trial cancellation without erasing paid buckets", () => {
    expect(welcomeGrantActive({
      createdAt,
      trialEndsAt: new Date("2026-01-04T00:00:00.000Z"),
    }, new Date("2026-01-04T00:00:00.000Z"))).toBe(false);
    expect(splitCreditDebit({
      welcomeCredits: 0,
      subscriptionCredits: 120,
      topupCredits: 60,
    }, 130)).toEqual({ welcome: 0, subscription: 120, topup: 10 });
  });

  it("debits welcome before subscriptions and purchased topups", () => {
    const row = { welcomeCredits: 150, subscriptionCredits: 120, topupCredits: 60 };
    expect(splitCreditDebit(row, 0)).toEqual({ welcome: 0, subscription: 0, topup: 0 });
    expect(splitCreditDebit(row, 100)).toEqual({ welcome: 100, subscription: 0, topup: 0 });
    expect(splitCreditDebit(row, 200)).toEqual({ welcome: 150, subscription: 50, topup: 0 });
    expect(splitCreditDebit(row, 300)).toEqual({ welcome: 150, subscription: 120, topup: 30 });
    expect(() => splitCreditDebit(row, 331)).toThrow("Insufficient active credits");
    expect(() => splitCreditDebit(row, -1)).toThrow("Insufficient active credits");
    expect(() => splitCreditDebit(row, 1.5)).toThrow("Insufficient active credits");
  });

  it("refunds welcome reservations only while the grant is active", async () => {
    const now = new Date();
    const row = {
      userId: "new-account",
      welcomeCredits: 30,
      subscriptionCredits: 120,
      topupCredits: 60,
      creditsRemaining: 210,
    };
    const owner = {
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    };
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({
              for: async () => [row],
              then: (resolve: (rows: unknown[]) => void) => resolve([owner]),
            }),
          }),
        }),
      }),
    };
    expect(await lockActiveCredits(tx as never, row.userId)).toBe(row);
    expect(await activeWelcomeRefund(tx as never, row.userId, 12)).toBe(12);
    expect(row.creditsRemaining).toBe(210);
    owner.trialEndsAt = new Date(now.getTime() - 1);
    // No remaining welcome balance to expire: an old reservation is still
    // forfeited rather than refunded after the grant's deadline.
    row.welcomeCredits = 0;
    row.creditsRemaining = 180;
    expect(await activeWelcomeRefund(tx as never, row.userId, 12)).toBe(0);
    expect(row.creditsRemaining).toBe(row.subscriptionCredits + row.topupCredits);
  });

  it("expires only the welcome bucket without confiscating purchased or subscription credits", async () => {
    const row = {
      userId: "new-account",
      welcomeCredits: 30,
      subscriptionCredits: 120,
      topupCredits: 60,
      creditsRemaining: 210,
    };
    const owner = { createdAt, trialEndsAt: sevenDays };
    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () => ({
              for: async () => [row],
              then: (resolve: (rows: unknown[]) => void) => resolve([table === creditsTable ? row : owner]),
            }),
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (changes: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (table === creditsTable && changes.welcomeCredits === 0) {
                row.creditsRemaining -= row.welcomeCredits;
                row.welcomeCredits = 0;
              }
              return [row];
            },
          }),
        }),
      }),
    };
    // The account is past the signup window (also tests the purchase-upgrade
    // case where the user still has a paid subscription and a topup).
    owner.trialEndsAt = new Date("2026-01-02T00:00:00.000Z");
    const expired = await lockActiveCredits(tx as never, row.userId);
    expect(expired).toMatchObject({
      welcomeCredits: 0, subscriptionCredits: 120,
      topupCredits: 60, creditsRemaining: 180,
    });
    expect(await activeWelcomeRefund(tx as never, row.userId, 30)).toBe(0);
    expect(row.creditsRemaining).toBe(row.subscriptionCredits + row.topupCredits);
  });
});