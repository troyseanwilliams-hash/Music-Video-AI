import { Router, type IRouter, type Request, type Response } from "express";
import { db, referralsTable } from "@workspace/db";
import { eq, sum, count } from "drizzle-orm";
import {
  getOrCreateReferralCode,
  REFERRER_CREDITS,
  REFERRED_CREDITS,
  MAX_CREDITED_REFERRALS,
} from "../lib/referrals.js";

const router: IRouter = Router();

// The signed-in user's referral code, share link, and lifetime stats.
router.get("/referrals/me", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const code = await getOrCreateReferralCode(req.user.id);

  const [stats] = await db
    .select({
      referredCount: count(),
      creditsEarned: sum(referralsTable.referrerCredits),
    })
    .from(referralsTable)
    .where(eq(referralsTable.referrerId, req.user.id));

  res.json({
    code,
    referredCount: Number(stats?.referredCount ?? 0),
    creditsEarned: Number(stats?.creditsEarned ?? 0),
    rewardPerReferral: REFERRER_CREDITS,
    referredBonus: REFERRED_CREDITS,
    maxCreditedReferrals: MAX_CREDITED_REFERRALS,
  });
});

export default router;
