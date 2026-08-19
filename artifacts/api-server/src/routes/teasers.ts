// Social exports cut from an existing finished video:
//   POST /videos/:id/teasers — 3 vertical 9:16 teaser cuts for TikTok/Shorts
//   POST /videos/:id/canvas  — one 9:16 loop (5s) for Spotify Canvas
// Both are pure ffmpeg (no AI), charged as small flat credit costs, and
// idempotent: once generated, repeat calls return the stored files free.

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { videosTable, jobsTable, creditsTable } from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ObjectStorageService } from "../lib/objectStorage.js";
import {
  pickTeaserMoments,
  cutTeasers,
  TEASER_COUNT,
  TEASER_DURATION_SEC,
} from "../lib/teaserGenerator.js";
import {
  TEASER_PACK_COST,
  CANVAS_EXPORT_COST,
  LYRIC_OVERLAY_COST,
  RELEASE_KIT_COST,
  calculateLipsyncCost,
  LIPSYNC_MIN_SECONDS,
  LIPSYNC_MAX_SECONDS,
} from "../lib/creditCost.js";
import { burnLyricsOnVideo } from "../lib/lyricOverlay.js";
import { extractVideoThumbnail } from "../lib/videoStitcher.js";
import { generateLipsync } from "../lib/lipsync.js";
import { trimAudioToLength } from "../lib/musicApis.js";
import { z } from "zod";

function isAdminEmail(email?: string | null): boolean {
  return !!(process.env.ADMIN_EMAIL && email && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
}

const router: IRouter = Router();
const storageService = new ObjectStorageService();

const CANVAS_DURATION_SEC = 5;

interface TeaserMetaRow {
  index: number;
  objectPath: string;
  startTime: number;
  durationSec: number;
  kind?: "teaser" | "canvas";
}

async function loadOwnedVideo(userId: string, videoId: string) {
  const [video] = await db
    .select()
    .from(videosTable)
    .where(
      and(
        eq(videosTable.id, videoId),
        eq(videosTable.userId, userId),
        isNull(videosTable.deletedAt),
      ),
    )
    .limit(1);
  return video ?? null;
}

type ChargeResult =
  | { ok: true; remaining: number; subDebit: number; topDebit: number }
  | { ok: false; remaining: number };

/**
 * Atomically debit credits. Row-locked (SELECT ... FOR UPDATE) so concurrent
 * exports can't both pass the balance check, and the exact subscription/top-up
 * split is recorded so a refund restores the same buckets.
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

async function withSignedUrls(metas: TeaserMetaRow[]) {
  return Promise.all(
    metas.map(async (m) => ({
      ...m,
      url: await storageService.getObjectEntitySignedUrl(m.objectPath, 3600),
    })),
  );
}

async function getAnalysisSections(jobId: string): Promise<unknown[] | null> {
  const [job] = await db
    .select({ audioAnalysis: jobsTable.audioAnalysis })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  const analysis = job?.audioAnalysis as { sections?: unknown[] } | null;
  return analysis?.sections ?? null;
}

async function generateCuts(params: {
  video: { id: string; jobId: string; videoObjectPath: string; durationSeconds: number | null };
  count: number;
  durationSec: number;
  startIndex: number;
  kind: "teaser" | "canvas";
}): Promise<TeaserMetaRow[]> {
  const { video, count, durationSec, startIndex, kind } = params;
  const sections = await getAnalysisSections(video.jobId);
  const file = await storageService.getObjectEntityFile(video.videoObjectPath);
  const [videoBuffer] = await file.download();
  const videoDuration = video.durationSeconds ?? 30;

  const moments = pickTeaserMoments(
    sections as Parameters<typeof pickTeaserMoments>[0],
    videoDuration,
    count,
    durationSec,
  );
  const buffers = await cutTeasers(videoBuffer, moments, durationSec);

  const metas: TeaserMetaRow[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const objectPath = await storageService.uploadTeaserBuffer(
      buffers[i]!,
      video.id,
      startIndex + i,
    );
    metas.push({
      index: startIndex + i,
      objectPath,
      startTime: Math.round(moments[i]! * 100) / 100,
      durationSec,
      kind,
    });
  }
  return metas;
}

function makeHandler(kind: "teaser" | "canvas") {
  return async (req: Request<{ id: string }>, res: Response) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const video = await loadOwnedVideo(req.user.id, req.params.id);
    if (!video) {
      res.status(404).json({ error: "Video not found" });
      return;
    }

    const existing = (video.teasers as TeaserMetaRow[] | null) ?? [];
    const mine = existing.filter((t) => (t.kind ?? "teaser") === kind);
    if (mine.length > 0) {
      // Already generated — return stored cuts, no charge.
      res.json({ teasers: await withSignedUrls(mine), charged: 0 });
      return;
    }

    const cost = kind === "teaser" ? TEASER_PACK_COST : CANVAS_EXPORT_COST;
    const charge = await chargeCredits(req.user.id, cost);
    if (!charge.ok) {
      res.status(402).json({
        error: `This export costs ${cost} credits but you only have ${charge.remaining}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: cost,
        creditsRemaining: charge.remaining,
      });
      return;
    }

    try {
      const metas = await generateCuts({
        video: {
          id: video.id,
          jobId: video.jobId,
          videoObjectPath: video.videoObjectPath,
          durationSeconds: video.durationSeconds,
        },
        count: kind === "teaser" ? TEASER_COUNT : 1,
        durationSec: kind === "teaser" ? TEASER_DURATION_SEC : CANVAS_DURATION_SEC,
        startIndex: existing.length,
        kind,
      });

      await db
        .update(videosTable)
        .set({ teasers: [...existing, ...metas] })
        .where(eq(videosTable.id, video.id));

      res.json({ teasers: await withSignedUrls(metas), charged: cost });
    } catch (err) {
      // Refund on failure so users aren't charged for nothing.
      await refundCredits(req.user.id, charge.subDebit, charge.topDebit);
      req.log.error({ err, videoId: video.id, kind }, "Social export failed (refunded)");
      res.status(500).json({ error: "Export failed — credits refunded. Please try again." });
    }
  };
}

router.post("/videos/:id/teasers", makeHandler("teaser"));
router.post("/videos/:id/canvas", makeHandler("canvas"));

// Burn karaoke lyrics onto a finished video → saved as a NEW video in the
// user's library (the original is untouched). Charged flat; refunded on
// failure. Lyrics accept plain text, LRC, or word-level enhanced LRC.
// acceptCopyright: server-side record of the rights attestation the UI collects
// (lyrics are copyrighted separately from the recording) — can't be bypassed.
const LyricsBody = z.object({
  lyricsText: z.string().min(1).max(5000),
  acceptCopyright: z.literal(true, {
    errorMap: () => ({ message: "You must confirm you have the rights to this song and its lyrics." }),
  }),
});

router.post("/videos/:id/lyrics", async (req: Request<{ id: string }>, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = LyricsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "lyricsText is required (max 5000 chars)" });
    return;
  }

  const video = await loadOwnedVideo(req.user.id, req.params.id);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const charge = await chargeCredits(req.user.id, LYRIC_OVERLAY_COST);
  if (!charge.ok) {
    res.status(402).json({
      error: `Burning lyrics costs ${LYRIC_OVERLAY_COST} credits but you only have ${charge.remaining}.`,
      code: "INSUFFICIENT_CREDITS",
      creditsRequired: LYRIC_OVERLAY_COST,
      creditsRemaining: charge.remaining,
    });
    return;
  }

  try {
    const file = await storageService.getObjectEntityFile(video.videoObjectPath);
    const [srcBuffer] = await file.download();
    const durationSeconds = video.durationSeconds ?? 30;

    const outBuffer = await burnLyricsOnVideo(srcBuffer, parsed.data.lyricsText, durationSeconds);
    const thumbnailBuffer = await extractVideoThumbnail(outBuffer, Math.max(1, durationSeconds * 0.3));

    const newVideoId = randomUUID();
    const [videoObjectPath, thumbnailObjectPath] = await Promise.all([
      storageService.uploadVideoBuffer(outBuffer, newVideoId),
      storageService.uploadThumbnailBuffer(thumbnailBuffer, newVideoId),
    ]);

    await db.insert(videosTable).values({
      id: newVideoId,
      userId: req.user.id,
      jobId: video.jobId,
      videoObjectPath,
      thumbnailObjectPath,
      title: `${video.title ?? "Video"} — lyrics`,
      durationSeconds: video.durationSeconds,
      style: video.style,
      prompt: video.prompt,
      shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    });

    // Work is durably delivered (video row inserted) — signing failures after
    // this point must NOT trigger a refund.
    try {
      const url = await storageService.getObjectEntitySignedUrl(videoObjectPath, 3600);
      res.json({ videoId: newVideoId, url, charged: LYRIC_OVERLAY_COST });
    } catch {
      res.json({ videoId: newVideoId, url: null, charged: LYRIC_OVERLAY_COST });
    }
  } catch (err) {
    await refundCredits(req.user.id, charge.subDebit, charge.topDebit);
    req.log.error({ err, videoId: video.id }, "Lyric overlay failed (refunded)");
    res.status(500).json({ error: "Lyric burn failed — credits refunded. Please try again." });
  }
});

// One-click "Release Kit": generate the missing social cuts (3 teasers + Canvas)
// in a single call at a bundled discount, optionally burn a karaoke-lyrics
// version, and return download URLs for the whole drop (full video, thumbnail,
// shorts, Canvas, lyric video). Already-generated parts are reused (not recharged).
const ReleaseKitBody = z
  .object({ lyricsText: z.string().max(5000).optional(), acceptCopyright: z.boolean().optional() })
  .refine((d) => !d.lyricsText?.trim() || d.acceptCopyright === true, {
    message: "You must confirm you have the rights to this song and its lyrics.",
  });

router.post("/videos/:id/release-kit", async (req: Request<{ id: string }>, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = ReleaseKitBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const lyricsText = parsed.data.lyricsText?.trim() || null;

  const video = await loadOwnedVideo(req.user.id, req.params.id);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const existing = (video.teasers as TeaserMetaRow[] | null) ?? [];
  const needTeasers = existing.filter((t) => (t.kind ?? "teaser") === "teaser").length === 0;
  const needCanvas = existing.filter((t) => t.kind === "canvas").length === 0;

  // Bundle price when both social parts are new; fair single-part price otherwise.
  let socialCost = 0;
  if (needTeasers && needCanvas) socialCost = RELEASE_KIT_COST;
  else if (needTeasers) socialCost = TEASER_PACK_COST;
  else if (needCanvas) socialCost = CANVAS_EXPORT_COST;
  const lyricsCost = lyricsText ? LYRIC_OVERLAY_COST : 0;
  const totalCost = socialCost + lyricsCost;

  let debit: { subDebit: number; topDebit: number } | null = null;
  if (totalCost > 0) {
    const charge = await chargeCredits(req.user.id, totalCost);
    if (!charge.ok) {
      res.status(402).json({
        error: `The Release Kit costs ${totalCost} credits but you only have ${charge.remaining}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: totalCost,
        creditsRemaining: charge.remaining,
      });
      return;
    }
    debit = { subDebit: charge.subDebit, topDebit: charge.topDebit };
  }

  const refund = async () => {
    if (!debit) return;
    await refundCredits(req.user.id, debit.subDebit, debit.topDebit);
  };

  try {
    const videoInfo = {
      id: video.id,
      jobId: video.jobId,
      videoObjectPath: video.videoObjectPath,
      durationSeconds: video.durationSeconds,
    };
    let all = [...existing];

    if (needTeasers) {
      const metas = await generateCuts({ video: videoInfo, count: TEASER_COUNT, durationSec: TEASER_DURATION_SEC, startIndex: all.length, kind: "teaser" });
      all = [...all, ...metas];
    }
    if (needCanvas) {
      const metas = await generateCuts({ video: videoInfo, count: 1, durationSec: CANVAS_DURATION_SEC, startIndex: all.length, kind: "canvas" });
      all = [...all, ...metas];
    }
    if (needTeasers || needCanvas) {
      await db.update(videosTable).set({ teasers: all }).where(eq(videosTable.id, video.id));
    }

    // Optional karaoke-lyrics version → saved as a NEW video (original untouched).
    let lyricVideo: { videoId: string; url: string } | null = null;
    if (lyricsText) {
      const file = await storageService.getObjectEntityFile(video.videoObjectPath);
      const [srcBuffer] = await file.download();
      const durationSeconds = video.durationSeconds ?? 30;
      const outBuffer = await burnLyricsOnVideo(srcBuffer, lyricsText, durationSeconds);
      const thumbBuffer = await extractVideoThumbnail(outBuffer, Math.max(1, durationSeconds * 0.3));
      const newVideoId = randomUUID();
      const [vPath, tPath] = await Promise.all([
        storageService.uploadVideoBuffer(outBuffer, newVideoId),
        storageService.uploadThumbnailBuffer(thumbBuffer, newVideoId),
      ]);
      await db.insert(videosTable).values({
        id: newVideoId,
        userId: req.user.id,
        jobId: video.jobId,
        videoObjectPath: vPath,
        thumbnailObjectPath: tPath,
        title: `${video.title ?? "Video"} — lyrics`,
        durationSeconds: video.durationSeconds,
        style: video.style,
        prompt: video.prompt,
        shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
      });
      lyricVideo = { videoId: newVideoId, url: await storageService.getObjectEntitySignedUrl(vPath, 3600) };
    }

    const [videoUrl, thumbnailUrl] = await Promise.all([
      storageService.getObjectEntitySignedUrl(video.videoObjectPath, 3600),
      video.thumbnailObjectPath
        ? storageService.getObjectEntitySignedUrl(video.thumbnailObjectPath, 3600)
        : Promise.resolve(null),
    ]);

    res.json({
      teasers: await withSignedUrls(all),
      videoUrl,
      thumbnailUrl,
      lyricVideo,
      charged: totalCost,
    });
  } catch (err) {
    await refund();
    req.log.error({ err, videoId: video.id }, "Release Kit failed (refunded)");
    res.status(500).json({ error: "Release Kit failed — credits refunded. Please try again." });
  }
});

// Lip sync: turn an uploaded face image into a singing avatar synced to a short
// clip (up to 30s) of this video's song, via the Pixazo OmniHuman model (billed
// per second). Saved as a NEW video. Credits are reserved up front and refunded
// if it fails; admins are free.
const LipsyncBody = z.object({
  imageObjectPath: z.string().min(1),
  lipsyncSeconds: z.number().int().min(LIPSYNC_MIN_SECONDS).max(LIPSYNC_MAX_SECONDS).default(15),
  // Admin-only segment picker (LyricSyncStudio): which part of the song to
  // sync to, instead of always the first lipsyncSeconds from 0:00. Ignored
  // (stays 0) for the regular user-facing LipSyncPanel, which doesn't expose
  // this control yet.
  lipsyncStartTime: z.number().min(0).max(3600).default(0),
});

router.post("/videos/:id/lipsync", async (req: Request<{ id: string }>, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = LipsyncBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A face image is required." });
    return;
  }

  const video = await loadOwnedVideo(req.user.id, req.params.id);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const admin = isAdminEmail(req.user.email);
  const lipsyncSeconds = parsed.data.lipsyncSeconds;
  const lipsyncStartTime = parsed.data.lipsyncStartTime;
  const cost = calculateLipsyncCost(lipsyncSeconds);

  // Reserve credits up front (non-admins). Refunded below if anything fails.
  let charged = false;
  if (!admin) {
    let [credits] = await db.select().from(creditsTable).where(eq(creditsTable.userId, req.user.id)).limit(1);
    if (!credits) {
      [credits] = await db.insert(creditsTable).values({ id: randomUUID(), userId: req.user.id }).returning();
    }
    if ((credits?.creditsRemaining ?? 0) < cost) {
      res.status(402).json({
        error: `Lip sync costs ${cost} credits but you have ${credits?.creditsRemaining ?? 0}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: cost,
        creditsRemaining: credits?.creditsRemaining ?? 0,
      });
      return;
    }
    await db
      .update(creditsTable)
      .set({
        subscriptionCredits: sql`GREATEST(subscription_credits - ${cost}, 0)`,
        topupCredits: sql`GREATEST(topup_credits - GREATEST(${cost} - subscription_credits, 0), 0)`,
        creditsRemaining: sql`GREATEST(credits_remaining - ${cost}, 0)`,
        creditsUsed: sql`credits_used + ${cost}`,
        updatedAt: new Date(),
      })
      .where(eq(creditsTable.userId, req.user.id));
    charged = true;
  }

  try {
    // Audio to sync to = the original job's song, trimmed to the chosen short
    // clip so the per-second lip sync cost stays bounded.
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, video.jobId)).limit(1);
    let audioUrl: string | null = null;
    if (job?.audioObjectPath) audioUrl = await storageService.getObjectEntitySignedUrl(job.audioObjectPath, 3600);
    else if (job?.audioSourceUrl) audioUrl = job.audioSourceUrl;
    if (!audioUrl) throw new Error("This video has no source audio to sync to.");

    const audioResp = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) });
    if (!audioResp.ok) throw new Error("Could not read the source audio.");
    const trimmed = await trimAudioToLength(Buffer.from(await audioResp.arrayBuffer()), "mp3", lipsyncSeconds, lipsyncStartTime);
    const trimmedPath = await storageService.uploadAudioBuffer(trimmed.buffer, randomUUID(), trimmed.ext);
    const trimmedAudioUrl = await storageService.getObjectEntitySignedUrl(trimmedPath, 3600);

    const imageUrl = await storageService.getObjectEntitySignedUrl(parsed.data.imageObjectPath, 3600);
    const mediaUrl = await generateLipsync({ imageUrl, audioUrl: trimmedAudioUrl });

    const resp = await fetch(mediaUrl, { signal: AbortSignal.timeout(120_000) });
    if (!resp.ok) throw new Error(`Could not fetch lip sync result: ${resp.status}`);
    const outBuffer = Buffer.from(await resp.arrayBuffer());
    const thumbBuffer = await extractVideoThumbnail(outBuffer, Math.max(1, lipsyncSeconds * 0.3));

    const newVideoId = randomUUID();
    const [vPath, tPath] = await Promise.all([
      storageService.uploadVideoBuffer(outBuffer, newVideoId),
      storageService.uploadThumbnailBuffer(thumbBuffer, newVideoId),
    ]);
    await db.insert(videosTable).values({
      id: newVideoId,
      userId: req.user.id,
      jobId: video.jobId,
      videoObjectPath: vPath,
      thumbnailObjectPath: tPath,
      title: `${video.title ?? "Video"} — lip sync`,
      durationSeconds: lipsyncSeconds,
      style: video.style,
      prompt: video.prompt,
      shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    });

    const url = await storageService.getObjectEntitySignedUrl(vPath, 3600);
    res.json({ videoId: newVideoId, url, creditsCharged: admin ? 0 : cost });
  } catch (err) {
    // Refund the reservation on failure.
    if (charged) {
      await db
        .update(creditsTable)
        .set({
          subscriptionCredits: sql`subscription_credits + ${cost}`,
          creditsRemaining: sql`credits_remaining + ${cost}`,
          creditsUsed: sql`GREATEST(credits_used - ${cost}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(creditsTable.userId, req.user.id));
    }
    req.log.error({ err, videoId: video.id }, "Lip sync failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Lip sync failed" });
  }
});

// Existing cuts (both kinds) with fresh signed URLs — used to hydrate the UI.
router.get("/videos/:id/teasers", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const video = await loadOwnedVideo(req.user.id, req.params.id);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const existing = (video.teasers as TeaserMetaRow[] | null) ?? [];
  res.json({ teasers: await withSignedUrls(existing) });
});

export default router;
