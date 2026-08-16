import { Router } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { alignLyrics, lyricAlignAvailable } from "../lib/lyricAlign.js";
import { db, creditsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { LYRIC_ALIGN_COST } from "../lib/creditCost.js";

const router = Router();
const storageService = new ObjectStorageService();

// Credit helpers — mirror the prompt-builder charge/refund split: charge up
// front (alignment always hits the paid AssemblyAI API), refund if it fails.
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

/**
 * POST /lyrics/align
 * Transcribe / align a loaded song into enhanced LRC for karaoke.
 * Body: { audioObjectPath: string, lyricsText?: string }
 * Returns: { lrc, confidence, source, wordCount, lowConfidence }
 */
router.post("/lyrics/align", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!lyricAlignAvailable()) {
    res.status(503).json({
      error: "Lyric alignment isn't configured (missing ASSEMBLYAI_API_KEY).",
      code: "ALIGN_UNAVAILABLE",
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const audioObjectPath = typeof body.audioObjectPath === "string" ? body.audioObjectPath.trim() : "";
  const lyricsText = typeof body.lyricsText === "string" ? body.lyricsText : null;
  if (!audioObjectPath) {
    res.status(400).json({ error: "audioObjectPath is required" });
    return;
  }

  let audioUrl: string;
  try {
    audioUrl = await storageService.getObjectEntitySignedUrl(audioObjectPath, 3600);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Audio file not found" });
      return;
    }
    throw err;
  }

  // Alignment always runs the paid AssemblyAI API, so it costs credits.
  const userId = (req.user as { id: string }).id;
  const charge = await chargeCredits(userId, LYRIC_ALIGN_COST);
  if (!charge.ok) {
    res.status(402).json({
      error: `Vocal alignment costs ${LYRIC_ALIGN_COST} credits but you only have ${charge.remaining}.`,
      code: "INSUFFICIENT_CREDITS",
      creditsRequired: LYRIC_ALIGN_COST,
      creditsRemaining: charge.remaining,
    });
    return;
  }

  try {
    const result = await alignLyrics({ audioUrl, lyricsText });
    res.json({ ...result, charged: LYRIC_ALIGN_COST });
  } catch (err) {
    await refundCredits(userId, LYRIC_ALIGN_COST);
    req.log.warn({ err, audioObjectPath }, "Lyric alignment failed (credits refunded)");
    res.status(502).json({ error: err instanceof Error ? err.message : "Lyric alignment failed" });
  }
});

export default router;
