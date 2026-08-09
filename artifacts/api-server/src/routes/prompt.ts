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
// prompt for the audio/video engines. Open to all signed-in users: the audio/
// video prompt builders are lightweight text helpers and stay free (rate-limited)
// as a top-of-funnel hook; writing full lyrics is a real deliverable and costs
// credits (LYRICS_BUILD_COST), so trial/free credits have something to spend on.

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
  res.json({
    enabled: true,
    provider: promptProviderAvailable(),
    lyricsProvider: lyricsProviderAvailable(),
    lyricsCost: LYRICS_BUILD_COST,
  });
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

const LyricsBody = z
  .object({
    theme: z.string().max(300).optional(),
    genre: z.string().max(60).optional(),
    mood: z.string().max(60).optional(),
    // When set, polish/enhance THIS draft instead of writing from scratch.
    lyrics: z.string().max(5000).optional(),
    // Target song length (seconds) — scales how much lyric to write.
    targetSeconds: z.number().int().min(10).max(600).optional(),
    // Allow explicit language (default clean).
    explicit: z.boolean().optional(),
    // Song tempo (BPM) for on-beat singability.
    bpm: z.number().int().min(40).max(240).optional(),
  })
  .refine(
    (d) => (d.theme?.trim().length ?? 0) >= 2 || (d.lyrics?.trim().length ?? 0) >= 2,
    { message: "Provide a theme, or draft lyrics to enhance." },
  );
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
    const result = await generateLyrics({
      theme: parsed.data.theme ?? "",
      genre: parsed.data.genre,
      mood: parsed.data.mood,
      existingLyrics: parsed.data.lyrics,
      targetSeconds: parsed.data.targetSeconds,
      explicit: parsed.data.explicit,
      bpm: parsed.data.bpm,
    });
    res.json({ ...result, charged: willUseLLM ? LYRICS_BUILD_COST : 0, enhanced: !!parsed.data.lyrics?.trim() });
  } catch (err) {
    if (willUseLLM) await refundCredits(user.id, LYRICS_BUILD_COST);
    logger.error({ err }, "Lyrics build failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Lyrics build failed" });
  }
});

export default router;
