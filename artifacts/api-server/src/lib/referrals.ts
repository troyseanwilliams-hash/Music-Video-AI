import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  creditsTable,
  creditGrantsTable,
  referralsTable,
} from "@workspace/db";
import { eq, sql, count } from "drizzle-orm";
import { logger } from "./logger.js";

// Referrer earns per successful signup, capped to limit farming. New users
// receive their one-time welcome credits in the registration transaction.
export const REFERRER_CREDITS = 100;
export const REFERRED_CREDITS = 0; // Welcome grant already covers the invitee.
export const MAX_CREDITED_REFERRALS = 20;

// Unambiguous alphabet (no 0/O/1/I) for hand-typeable codes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Returns the user's referral code, generating one on first use. */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const [user] = await db
    .select({ referralCode: usersTable.referralCode })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) throw new Error("user not found");
  if (user.referralCode) return user.referralCode;

  // Retry on the (unlikely) unique collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      await db
        .update(usersTable)
        .set({ referralCode: code })
        .where(eq(usersTable.id, userId));
      return code;
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  throw new Error("could not generate referral code");
}

async function ensureCreditsRow(userId: string): Promise<void> {
  await db
    .insert(creditsTable)
    .values({ id: randomUUID(), userId })
    .onConflictDoNothing({ target: creditsTable.userId });
}

/** Grants referral credits into the non-expiring top-up bucket + audit row. */
async function grantReferralCredits(
  userId: string,
  credits: number,
): Promise<void> {
  if (credits <= 0) return;
  await ensureCreditsRow(userId);
  await db.insert(creditGrantsTable).values({
    id: randomUUID(),
    userId,
    source: "referral",
    creditsGranted: credits,
  });
  await db
    .update(creditsTable)
    .set({
      creditsRemaining: sql`${creditsTable.creditsRemaining} + ${credits}`,
      topupCredits: sql`${creditsTable.topupCredits} + ${credits}`,
    })
    .where(eq(creditsTable.userId, userId));
}

/**
 * Called after a new user registers with a referral code. Never throws —
 * referral failures must not break signup. Idempotent via the unique
 * referred_id on referrals.
 */
export async function processReferralSignup(
  code: string,
  newUserId: string,
): Promise<void> {
  try {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;

    const [referrer] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, normalized))
      .limit(1);
    if (!referrer) {
      logger.info({ code: normalized }, "referral: unknown code at signup");
      return;
    }
    if (referrer.id === newUserId) return; // self-referral

    // Cap referrer earnings.
    const [{ value: creditedCount }] = await db
      .select({ value: count() })
      .from(referralsTable)
      .where(eq(referralsTable.referrerId, referrer.id));
    const referrerCredits =
      creditedCount >= MAX_CREDITED_REFERRALS ? 0 : REFERRER_CREDITS;

    // Idempotency gate: one referral row per referred user, ever.
    const [row] = await db
      .insert(referralsTable)
      .values({
        id: randomUUID(),
        referrerId: referrer.id,
        referredId: newUserId,
        code: normalized,
        status: "credited",
        referrerCredits,
        referredCredits: REFERRED_CREDITS,
      })
      .onConflictDoNothing({ target: referralsTable.referredId })
      .returning();
    if (!row) return; // already credited

    await grantReferralCredits(referrer.id, referrerCredits);

    logger.info(
      { referrerId: referrer.id, referredId: newUserId, referrerCredits },
      "referral: credited signup",
    );
  } catch (err) {
    logger.error({ err }, "referral: failed to process signup (non-fatal)");
  }
}
