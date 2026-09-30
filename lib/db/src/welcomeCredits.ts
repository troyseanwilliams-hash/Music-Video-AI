import { eq, sql } from "drizzle-orm";
import { creditsTable, usersTable } from "./schema/index.js";
import type { db } from "./index.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function welcomeGrantActive(
  owner: { createdAt: Date; trialEndsAt: Date | null },
  now: Date,
) {
  return !!owner.trialEndsAt
    && now.getTime() < owner.trialEndsAt.getTime()
    && now.getTime() < owner.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000;
}

// Always call under the same transaction as a debit/refund. Locking this row
// serializes expiry, grants, and reservations, including across API and worker.
export async function lockActiveCredits(tx: Tx, userId: string) {
  const [row] = await tx.select().from(creditsTable)
    .where(eq(creditsTable.userId, userId)).limit(1).for("update");
  if (!row) return null;
  if (!row.welcomeCredits) return row;
  const [owner] = await tx.select({ trialEndsAt: usersTable.trialEndsAt, createdAt: usersTable.createdAt }).from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1);
  if (!owner || !welcomeGrantActive(owner, new Date())) {
    const [expired] = await tx.update(creditsTable).set({
      welcomeCredits: 0,
      creditsRemaining: sql`credits_remaining - ${row.welcomeCredits}`,
    }).where(eq(creditsTable.userId, userId)).returning();
    return expired;
  }
  return row;
}

export function splitCreditDebit(
  row: Pick<typeof creditsTable.$inferSelect, "welcomeCredits" | "subscriptionCredits" | "topupCredits">,
  amount: number,
) {
  const welcome = Math.min(amount, row.welcomeCredits);
  const subscription = Math.min(amount - welcome, row.subscriptionCredits);
  const topup = amount - welcome - subscription;
  if (!Number.isSafeInteger(amount) || amount < 0 || topup > row.topupCredits) {
    throw new Error("Insufficient active credits");
  }
  return { welcome, subscription, topup };
}

export function debitCreditColumns(split: ReturnType<typeof splitCreditDebit>, amount: number) {
  return {
    welcomeCredits: sql`welcome_credits - ${split.welcome}`,
    subscriptionCredits: sql`subscription_credits - ${split.subscription}`,
    topupCredits: sql`topup_credits - ${split.topup}`,
    creditsRemaining: sql`credits_remaining - ${amount}`,
    creditsUsed: sql`credits_used + ${amount}`,
  };
}

export function refundCreditColumns(
  split: ReturnType<typeof splitCreditDebit>,
  activeWelcome: number,
) {
  return {
    welcomeCredits: sql`welcome_credits + ${activeWelcome}`,
    subscriptionCredits: sql`subscription_credits + ${split.subscription}`,
    topupCredits: sql`topup_credits + ${split.topup}`,
    creditsRemaining: sql`credits_remaining + ${activeWelcome + split.subscription + split.topup}`,
    creditsUsed: sql`GREATEST(credits_used - ${split.welcome + split.subscription + split.topup}, 0)`,
  };
}

// A refund for a welcome-funded reservation is forfeited at the expiry
// boundary; paid subscriptions and purchased topups remain fully refundable.
export async function activeWelcomeRefund(tx: Tx, userId: string, amount: number) {
  const row = await lockActiveCredits(tx, userId);
  if (!row || !amount) return 0;
  const [owner] = await tx.select({ trialEndsAt: usersTable.trialEndsAt, createdAt: usersTable.createdAt }).from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1);
  return owner && welcomeGrantActive(owner, new Date()) ? amount : 0;
}