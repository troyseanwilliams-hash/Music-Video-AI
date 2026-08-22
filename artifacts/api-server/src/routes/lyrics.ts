import { Router } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { alignLyrics, lyricAlignAvailable } from "../lib/lyricAlign.js";
import { db, creditsTable, soundtracksTable, usersTable, videosTable } from "@workspace/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { LYRIC_ALIGN_COST, TRIAL_FREE_ALIGNS } from "../lib/creditCost.js";
import { MAX_LYRICS_LENGTH } from "../lib/lyricLimits.js";

const router = Router();
const storageService = new ObjectStorageService();

type ChargeResult =
  | { ok: true; remaining: number; subDebit: number; topDebit: number }
  | { ok: false; remaining: number };

/**
 * Atomically debit credits. Row-locked (SELECT ... FOR UPDATE) so two
 * concurrent align calls can't both pass the balance check, and the exact
 * subscription/top-up split is recorded so a refund restores the same buckets.
 */
async function chargeCredits(userId: string, cost: number): Promise<ChargeResult> {
  return db.transaction(async (tx) => {
    let [c] = await tx.select().from(creditsTable).where(eq(creditsTable.userId, userId)).limit(1).for("update");
    if (!c) [c] = await tx.insert(creditsTable).values({ id: randomUUID(), userId }).returning();
    if (c!.creditsRemaining < cost) return { ok: false as const, remaining: c!.creditsRemaining };
    const subDebit = Math.min(c!.subscriptionCredits, cost);
    const topDebit = cost - subDebit;
    await tx.update(creditsTable).set({
      subscriptionCredits: sql`subscription_credits - ${subDebit}`,
      topupCredits: sql`topup_credits - ${topDebit}`,
      creditsRemaining: sql`credits_remaining - ${cost}`,
      creditsUsed: sql`credits_used + ${cost}`,
      updatedAt: new Date(),
    }).where(eq(creditsTable.userId, userId));
    return { ok: true as const, remaining: c!.creditsRemaining - cost, subDebit, topDebit };
  });
}

/** Refund exactly the buckets that were debited. */
async function refundCredits(userId: string, subDebit: number, topDebit: number): Promise<void> {
  await db.update(creditsTable).set({
    subscriptionCredits: sql`subscription_credits + ${subDebit}`,
    topupCredits: sql`topup_credits + ${topDebit}`,
    creditsRemaining: sql`credits_remaining + ${subDebit + topDebit}`,
    creditsUsed: sql`GREATEST(credits_used - ${subDebit + topDebit}, 0)`,
    updatedAt: new Date(),
  }).where(eq(creditsTable.userId, userId));
}

/**
 * Trial allowance: consume one of the user's TRIAL_FREE_ALIGNS free auto-sync
 * runs. Row-locked so concurrent aligns can't both grab the last free slot.
 * - "free":      a free slot was consumed (no credit charge needed)
 * - "exhausted": user is on an active trial with no free slots left — Auto-sync
 *                is LOCKED for the rest of the trial (no pay-with-credits path)
 * - "not_trial": not on a trial — normal credit charging applies
 */
async function consumeTrialAlign(userId: string): Promise<"free" | "exhausted" | "not_trial"> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1).for("update");
    if (!u) return "not_trial";
    const isAdmin = !!(
      process.env.ADMIN_EMAIL && u.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
    );
    const trialActive =
      !isAdmin &&
      !!u.trialEndsAt && new Date(u.trialEndsAt).getTime() > Date.now() &&
      u.subscriptionStatus !== "active";
    if (!trialActive) return "not_trial";
    if (u.trialAlignsUsed >= TRIAL_FREE_ALIGNS) return "exhausted";
    await tx.update(usersTable)
      .set({ trialAlignsUsed: sql`trial_aligns_used + 1` })
      .where(eq(usersTable.id, userId));
    return "free";
  });
}

/** 403 payload when a trial user has used all free Auto-syncs. */
const TRIAL_ALIGN_LOCKED = {
  error: `You've used your ${TRIAL_FREE_ALIGNS} free Auto-syncs. Auto-sync unlocks again when you subscribe — you can still type or paste lyrics (including LRC timestamps) for free.`,
  code: "TRIAL_ALIGN_EXHAUSTED",
  trialAlignLimit: TRIAL_FREE_ALIGNS,
};

/** Give back a free trial slot when the alignment itself failed. */
async function releaseTrialAlign(userId: string): Promise<void> {
  await db.update(usersTable)
    .set({ trialAlignsUsed: sql`GREATEST(trial_aligns_used - 1, 0)` })
    .where(eq(usersTable.id, userId));
}

/** An LRC is usable when it has at least one timestamped line. */
function lrcUsable(lrc: unknown): boolean {
  return typeof lrc === "string" && /\[\d{2}:\d{2}/.test(lrc);
}

/**
 * POST /lyrics/align
 * Transcribe / align a loaded song into enhanced LRC for karaoke.
 * Body: { audioObjectPath?: string, videoId?: string, lyricsText?: string }
 * (exactly one of audioObjectPath / videoId — videoId reads the audio track of
 * one of the user's own finished videos)
 * Returns: { lrc, confidence, source, wordCount, lowConfidence, charged }
 * Costs LYRIC_ALIGN_COST credits; refunded if alignment fails.
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
  const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
  if (!audioObjectPath && !videoId) {
    res.status(400).json({ error: "audioObjectPath or videoId is required" });
    return;
  }
  if (audioObjectPath && videoId) {
    res.status(400).json({ error: "Provide exactly one of audioObjectPath or videoId" });
    return;
  }
  if (lyricsText && lyricsText.length > MAX_LYRICS_LENGTH) {
    res.status(400).json({
      error: `Lyrics must be ${MAX_LYRICS_LENGTH.toLocaleString()} characters or fewer.`,
      code: "LYRICS_TOO_LONG",
      maximum: MAX_LYRICS_LENGTH,
    });
    return;
  }
  // Server-side record of the rights attestation the UI collects — lyrics are
  // copyrighted separately from the recording, so this can't be bypassed.
  if (body.acceptCopyright !== true) {
    res.status(400).json({
      error: "You must confirm you have the rights to this song and its lyrics.",
      code: "COPYRIGHT_NOT_ACCEPTED",
    });
    return;
  }

  const userId = (req.user as { id: string }).id;

  // Video source: align against the audio track of one of the user's own
  // videos (AssemblyAI transcribes the audio of a video URL directly).
  if (videoId) {
    const [video] = await db
      .select({ videoObjectPath: videosTable.videoObjectPath })
      .from(videosTable)
      .where(and(eq(videosTable.id, videoId), eq(videosTable.userId, userId), isNull(videosTable.deletedAt)))
      .limit(1);
    if (!video?.videoObjectPath) {
      res.status(404).json({ error: "Video not found" });
      return;
    }
    const trialSlot = await consumeTrialAlign(userId);
    if (trialSlot === "exhausted") {
      res.status(403).json(TRIAL_ALIGN_LOCKED);
      return;
    }
    const freeTrialSlot = trialSlot === "free";
    let charge: ChargeResult | null = null;
    if (!freeTrialSlot) {
      charge = await chargeCredits(userId, LYRIC_ALIGN_COST);
      if (!charge.ok) {
        res.status(402).json({
          error: `Vocal alignment costs ${LYRIC_ALIGN_COST} credits but you only have ${charge.remaining}.`,
          code: "INSUFFICIENT_CREDITS",
          creditsRequired: LYRIC_ALIGN_COST,
          creditsRemaining: charge.remaining,
        });
        return;
      }
    }
    try {
      const audioUrl = await storageService.getObjectEntitySignedUrl(video.videoObjectPath, 3600);
      const result = await alignLyrics({ audioUrl, lyricsText });
      if (!lrcUsable(result.lrc)) throw new Error("Alignment produced no usable timing");
      res.json({ ...result, charged: freeTrialSlot ? 0 : LYRIC_ALIGN_COST, trialFree: freeTrialSlot });
    } catch (err) {
      if (freeTrialSlot) await releaseTrialAlign(userId);
      else if (charge?.ok) await refundCredits(userId, charge.subDebit, charge.topDebit);
      req.log.warn({ err, videoId }, "Lyric alignment from video failed (charge released)");
      res.status(502).json({ error: err instanceof Error ? err.message : "Lyric alignment failed" });
    }
    return;
  }

  // Ownership check: only sign objects this user is allowed to read.
  // Audio objects in this app don't carry storage-level ACL metadata, so
  // authorize at the app level: the path must be a soundtrack the user owns
  // (or a public one), or a direct upload (unguessable UUID under uploads/).
  let audioUrl: string;
  try {
    const objectFile = await storageService.getObjectEntityFile(audioObjectPath);
    let allowed = await storageService.canAccessObjectEntity({ userId, objectFile });
    if (!allowed) {
      const [track] = await db
        .select({ id: soundtracksTable.id })
        .from(soundtracksTable)
        .where(and(
          eq(soundtracksTable.objectPath, audioObjectPath),
          isNull(soundtracksTable.deletedAt),
          or(eq(soundtracksTable.userId, userId), eq(soundtracksTable.isPublic, true)),
        ))
        .limit(1);
      allowed = Boolean(track) || audioObjectPath.startsWith("/objects/uploads/");
    }
    if (!allowed) {
      res.status(403).json({ error: "You don't have access to that audio file" });
      return;
    }
    audioUrl = await storageService.getObjectEntitySignedUrl(audioObjectPath, 3600);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Audio file not found" });
      return;
    }
    throw err;
  }

  // Alignment always runs the paid AssemblyAI API, so it costs credits —
  // except for the small free trial allowance. Trial users who've used their
  // allowance are locked out until they subscribe.
  const trialSlot = await consumeTrialAlign(userId);
  if (trialSlot === "exhausted") {
    res.status(403).json(TRIAL_ALIGN_LOCKED);
    return;
  }
  const freeTrialSlot = trialSlot === "free";
  let charge: ChargeResult | null = null;
  if (!freeTrialSlot) {
    charge = await chargeCredits(userId, LYRIC_ALIGN_COST);
    if (!charge.ok) {
      res.status(402).json({
        error: `Vocal alignment costs ${LYRIC_ALIGN_COST} credits but you only have ${charge.remaining}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: LYRIC_ALIGN_COST,
        creditsRemaining: charge.remaining,
      });
      return;
    }
  }

  try {
    const result = await alignLyrics({ audioUrl, lyricsText });
    if (!lrcUsable(result.lrc)) throw new Error("Alignment produced no usable timing");
    res.json({ ...result, charged: freeTrialSlot ? 0 : LYRIC_ALIGN_COST, trialFree: freeTrialSlot });
  } catch (err) {
    if (freeTrialSlot) await releaseTrialAlign(userId);
    else if (charge?.ok) await refundCredits(userId, charge.subDebit, charge.topDebit);
    req.log.warn({ err, audioObjectPath }, "Lyric alignment failed (charge released)");
    res.status(502).json({ error: err instanceof Error ? err.message : "Lyric alignment failed" });
  }
});

export default router;
