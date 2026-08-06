import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, usersTable, promoRedemptionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// Promo codes. Extend by adding entries. trialDays extends the free-trial window
// (unlocks the free features — Prompt Studio, Remix Lab, free Soundtracks).
const PROMOS: Record<string, { trialDays: number; label: string }> = {
  COMEBACK7: { trialDays: 7, label: "7 extra days of free trial" },
};

const Body = z.object({ code: z.string().min(2).max(40) });

// GET /promo/:code — look up a code without redeeming (drives the /redeem page).
router.get("/promo/:code", (req: Request, res: Response) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  const promo = PROMOS[code];
  if (!promo) {
    res.status(404).json({ valid: false, error: "That code isn't valid." });
    return;
  }
  res.json({ valid: true, code, trialDays: promo.trialDays, label: promo.label });
});

// POST /promo/redeem { code } — redeem a promo for the signed-in user.
router.post("/promo/redeem", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Please sign in to redeem a code.", code: "AUTH_REQUIRED" });
    return;
  }
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid code." });
    return;
  }
  const code = parsed.data.code.trim().toUpperCase();
  const promo = PROMOS[code];
  if (!promo) {
    res.status(404).json({ error: "That code isn't valid.", code: "INVALID_CODE" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Active members don't need a trial extension.
  if ((user.subscriptionStatus ?? "none") === "active") {
    res.status(400).json({
      error: "You're already a member — this code is for trial accounts.",
      code: "ALREADY_MEMBER",
    });
    return;
  }

  // Once per user per code.
  const [already] = await db
    .select()
    .from(promoRedemptionsTable)
    .where(and(eq(promoRedemptionsTable.userId, user.id), eq(promoRedemptionsTable.code, code)))
    .limit(1);
  if (already) {
    res.status(409).json({ error: "You've already redeemed this code.", code: "ALREADY_REDEEMED" });
    return;
  }

  // Extend from the later of now / current trial end so an active trial is
  // extended (never shortened).
  const now = Date.now();
  const currentEnd = user.trialEndsAt ? new Date(user.trialEndsAt).getTime() : 0;
  const base = currentEnd > now ? currentEnd : now;
  const newTrialEnds = new Date(base + promo.trialDays * 24 * 60 * 60 * 1000);

  // Record first so the unique index blocks double-redeem races.
  try {
    await db.insert(promoRedemptionsTable).values({ id: randomUUID(), userId: user.id, code });
  } catch {
    res.status(409).json({ error: "You've already redeemed this code.", code: "ALREADY_REDEEMED" });
    return;
  }

  await db
    .update(usersTable)
    .set({ subscriptionStatus: "trial", trialEndsAt: newTrialEnds })
    .where(eq(usersTable.id, user.id));

  logger.info({ userId: user.id, code, trialEndsAt: newTrialEnds.toISOString() }, "Promo code redeemed");
  res.json({
    ok: true,
    code,
    trialDays: promo.trialDays,
    trialEndsAt: newTrialEnds.toISOString(),
    message: `Success! You've unlocked ${promo.label}.`,
  });
});

export default router;
