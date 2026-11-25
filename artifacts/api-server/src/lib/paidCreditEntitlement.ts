import { and, eq, gt } from "drizzle-orm";
import { creditGrantsTable, creditsTable, type db } from "@workspace/db";
import { canCreateCreditFundedMedia } from "./generationEligibility.js";

// Works with the pool client and with a transaction handle.
type Executor = Pick<typeof db, "select">;

type EntitlementUser = {
  id?: string | null;
  subscriptionStatus?: string | null;
  trialEndsAt?: Date | string | null;
} | null | undefined;

/**
 * True when the user bought a credit pack (a Stripe "topup" grant) and still
 * holds top-up credits. Purchased credits are advertised as never expiring, so
 * they must stay usable after the 7-day trial ends and without a subscription.
 *
 * Referral and admin credits also land in the top-up bucket, so the bucket
 * alone is not proof of purchase: we also require a real "topup" grant row.
 */
export async function hasPurchasedTopupCredits(exec: Executor, userId: string): Promise<boolean> {
  const [balance] = await exec
    .select({ topupCredits: creditsTable.topupCredits })
    .from(creditsTable)
    .where(and(eq(creditsTable.userId, userId), gt(creditsTable.topupCredits, 0)))
    .limit(1);
  if (!balance) return false;

  const [purchase] = await exec
    .select({ id: creditGrantsTable.id })
    .from(creditGrantsTable)
    .where(and(eq(creditGrantsTable.userId, userId), eq(creditGrantsTable.source, "topup")))
    .limit(1);
  return Boolean(purchase);
}

/**
 * Entitlement to spend credits on generation: an active subscription, an
 * unexpired trial, OR purchased top-up credits.
 */
export async function canCreateCreditFundedMediaWithPurchases(
  exec: Executor,
  user: EntitlementUser,
  now = Date.now(),
): Promise<boolean> {
  if (canCreateCreditFundedMedia(user, now)) return true;
  if (!user?.id) return false;
  return hasPurchasedTopupCredits(exec, user.id);
}
