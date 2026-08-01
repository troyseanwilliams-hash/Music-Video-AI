import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import {
  generateAudioPrompt,
  generateVideoPrompt,
  promptProviderAvailable,
} from "../lib/promptBuilder.js";
import { generateLyrics, lyricsProviderAvailable } from "../lib/lyricsGen.js";
import { db, creditsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { LYRICS_BUILD_COST } from "../lib/creditCost.js";

const router: IRouter = Router();

// Small credit helpers (mirror the social-export charge/refund split).
async function chargeCredits(userId: string, cost: number): Promise<{ ok: boolean; remaining: number }> {
  let [c] = await db.select().from(creditsTable).where(eq(creditsTable.userId, userId)).limit(1);
  if (!c) [c] = await db.insert(creditsTable).values({ id: randomUUID(), userId }).returning();
  if (c!.creditsRemaining < cost) return { ok: false, remaining: c!.creditsRemaining };
  await db.update(creditsTable).set({
    subscriptionCredits: sql`GREATEST(subscription_credits - ${cost}, 0)`,
    topupCredits: sql`GREATEST(topup_credits - GREATEST(${cost} - subscription_credits, 0), 0)`,
    creditsRemaining: sql`GREATEST(credits_remaining - ${cost}, 0)`,
    creditsUsed: sql`credits_used + ${cost}`,
    updatedAt: new Date(),
  }).where(eq(creditsTable.userId, userId));
  return { ok: true, remaining: c!.creditsRemaining - cost };
}
async function refundCredits(userId: string, cost: number): Promise<void> {
  await db.update(creditsTable).set({
    topupCredits: sql`topup_credits + ${cost}`,
    creditsRemaining: sql`credits_remaining + ${cost}`,
    creditsUsed: sql`GREATEST(credits_used - ${cost}, 0)`,
    updatedAt: new Date(),
  }).where(eq(creditsTable.userId, userId));
}

// Prompt Builder — helper endpoints that turn a plain description into a polished
// prompt for the audio/video engines. Text-only LLM calls (cheap), so no credit
// deduction. TEMPORARY: gated to admin only while the feature is being evaluated.
// To open it to all signed-in users later, drop the isAdmin() check in guard().
function isAdmin(email: string | null | undefined): boolean {
  return !!(process.env.ADMIN_EMAIL && email && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
}

// ── Light in-memory per-user rate limit (max N requests / window) ─────────────
const RL_WINDOW_MS = 60_000;
const RL_MAX = 30; // generous — text calls are cheap
const hits = new Map<string, number[]>();
function rateLimited(userId: string): boolean {
  const now = Date.now();
  const arr = (hits.get(userId) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) {
    hits.set(userId, arr);
    return true;
  }
  arr.push(now);
  hits.set(userId, arr);
  return false;
}

function guard(req: Request, res: Response): boolean {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  // TEMPORARY admin gate while evaluating the Prompt Builder.
  if (!isAdmin(req.user.email)) {
    res.status(403).json({ error: "Prompt Studio is in limited preview." });
    return false;
  }
  if (rateLimited(req.user.id)) {
    res.status(429).json({ error: "Slow down a moment — too many prompt requests. Try again shortly." });
    return false;
  }
  return true;
}

// Whether the Prompt Builder is backed by a real LLM (vs. template fallback).
router.get("/prompt/status", (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ enabled: isAdmin(req.user.email), provider: promptProviderAvailable(), lyricsProvider: lyricsProviderAvailable() });
});

const AudioBody = z.object({ description: z.string().min(2).max(600) });
router.post("/prompt/audio", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const parsed = AudioBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    res.json(await generateAudioPrompt(parsed.data.description));
  } catch (err) {
    logger.error({ err }, "Audio prompt build failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Prompt build failed" });
  }
});

const VideoBody = z.object({
  description: z.string().min(2).max(600),
  style: z.string().max(40).optional(),
  aspectRatio: z.string().max(10).optional(),
});
router.post("/prompt/video", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const parsed = VideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const { description, ...opts } = parsed.data;
    res.json(await generateVideoPrompt(description, opts));
  } catch (err) {
    logger.error({ err }, "Video prompt build failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Prompt build failed" });
  }
});

const LyricsBody = z.object({
  theme: z.string().min(2).max(300),
  genre: z.string().max(60).optional(),
  mood: z.string().max(60).optional(),
});
router.post("/prompt/lyrics", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const parsed = LyricsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Charge only when a real LLM will run (the no-key template fallback is free).
  const willUseLLM = lyricsProviderAvailable() !== "template";
  if (willUseLLM) {
    const charge = await chargeCredits(user.id, LYRICS_BUILD_COST);
    if (!charge.ok) {
      res.status(402).json({
        error: `Writing lyrics costs ${LYRICS_BUILD_COST} credits but you only have ${charge.remaining}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: LYRICS_BUILD_COST,
        creditsRemaining: charge.remaining,
      });
      return;
    }
  }
  try {
    const result = await generateLyrics(parsed.data);
    res.json({ ...result, charged: willUseLLM ? LYRICS_BUILD_COST : 0 });
  } catch (err) {
    if (willUseLLM) await refundCredits(user.id, LYRICS_BUILD_COST);
    logger.error({ err }, "Lyrics build failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Lyrics build failed" });
  }
});

export default router;
