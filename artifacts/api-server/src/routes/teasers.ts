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
  calculateLipsyncCostFromSourceVideo,
  LIPSYNC_MIN_SECONDS,
  LIPSYNC_MAX_SECONDS,
} from "../lib/creditCost.js";
import { burnLyricsOnVideo } from "../lib/lyricOverlay.js";
import { extractVideoThumbnail } from "../lib/videoStitcher.js";
import { z } from "zod";
import { MAX_LYRICS_LENGTH } from "../lib/lyricLimits.js";

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
  lyricsText: z.string().min(1).max(MAX_LYRICS_LENGTH),
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
    res.status(400).json({
      error: `Lyrics are required and must be ${MAX_LYRICS_LENGTH.toLocaleString()} characters or fewer.`,
    });
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
  .object({
    lyricsText: z.string().max(MAX_LYRICS_LENGTH).optional(),
    acceptCopyright: z.boolean().optional(),
  })
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

// Lip sync: queue an uploaded face image plus a short range of this video's
// soundtrack as a background job. Returning immediately avoids the five-minute
// HTTP request limit while the long-running AI render continues in the worker.
const LipsyncBody = z.object({
  imageObjectPath: z.string().min(1),
  lipsyncSeconds: z.number().int().min(LIPSYNC_MIN_SECONDS).max(LIPSYNC_MAX_SECONDS).default(15),
  // Which portion of the song to sync to. Both the public Lip Sync panel and
  // the admin studio can set this, while the default preserves the first clip.
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

  // Price from the source video's own real provider cost (not the credits it
  // was originally charged, which already carry its own markup) whenever that
  // video has well-defined generation inputs. A Studio "editor_render" export
  // stitches pre-existing clips via ffmpeg with no AI provider call of its
  // own, so it has no real cost to price from -- fall back to the
  // duration-based rate (same one the standalone Lip Sync Generator uses).
  const [sourceJob] = await db.select().from(jobsTable).where(eq(jobsTable.id, video.jobId)).limit(1);
  const sourceSongDurationSec = (sourceJob?.audioAnalysis as { durationSeconds?: number } | null | undefined)
    ?.durationSeconds;
  const sourceManifest = sourceJob?.manifest && typeof sourceJob.manifest === "object"
    ? sourceJob.manifest as { generationMode?: unknown }
    : {};
  const sourceGenerationMode =
    sourceManifest.generationMode === "narrative" ? "narrative" : "montage";
  const cost =
    sourceJob && (sourceJob.jobType === "ai" || sourceJob.jobType === "remix")
      ? calculateLipsyncCostFromSourceVideo(
          sourceJob.requestedDuration,
          sourceJob.resolution,
          sourceSongDurationSec,
          sourceJob.aiProvider,
          sourceGenerationMode,
        )
      : calculateLipsyncCost(lipsyncSeconds);
  const videoDuration = Number(video.durationSeconds);
  if (
    Number.isFinite(videoDuration) &&
    videoDuration > 0 &&
    lipsyncStartTime + lipsyncSeconds > videoDuration + 0.01
  ) {
    res.status(422).json({
      error: `Choose a range that ends within the video. This clip would end at ${Math.ceil(lipsyncStartTime + lipsyncSeconds)}s, but the video is ${Math.floor(videoDuration)}s long.`,
      code: "LIPSYNC_RANGE_OUT_OF_BOUNDS",
    });
    return;
  }

  // Reserve credits up front (non-admins). Keep the exact bucket split so a
  // provider/storage failure restores precisely what was debited.
  let charged: { subDebit: number; topDebit: number } | null = null;
  if (!admin) {
    const charge = await chargeCredits(req.user.id, cost);
    if (!charge.ok) {
      res.status(402).json({
        error: `Lip sync costs ${cost} credits but you have ${charge.remaining}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: cost,
        creditsRemaining: charge.remaining,
      });
      return;
    }
    charged = { subDebit: charge.subDebit, topDebit: charge.topDebit };
  }

  try {
    const [sourceJob] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, video.jobId))
      .limit(1);

    let audioObjectPath: string | null = null;
    let audioSourceUrl: string | null = null;
    let audioSourceType: "upload" | "suno" | null = null;
    if (sourceJob?.audioObjectPath) {
      audioObjectPath = sourceJob.audioObjectPath;
      audioSourceType = "upload";
    } else if (sourceJob?.audioSourceUrl) {
      audioSourceUrl = sourceJob.audioSourceUrl;
      audioSourceType = "suno";
    } else if (video.hasAudio !== false && video.videoObjectPath) {
      // Remix/Editor and legacy videos may carry their only authoritative audio
      // in the owned finished MP4. The worker can extract the selected range.
      audioObjectPath = video.videoObjectPath;
      audioSourceType = "upload";
    }
    if (!audioObjectPath && !audioSourceUrl) {
      throw new Error("This video has no source audio to sync to.");
    }

    const lipSyncJobId = randomUUID();
    const title = `${video.title ?? "Video"} — lip sync`;
    await db.insert(jobsTable).values({
      id: lipSyncJobId,
      userId: req.user.id,
      jobType: "runway_lipsync",
      status: "queued",
      prompt: title,
      style: video.style,
      referenceImagePath: parsed.data.imageObjectPath,
      audioSourceType,
      audioObjectPath,
      audioSourceUrl,
      clipStartTime: lipsyncStartTime,
      requestedDuration: String(lipsyncSeconds),
      aspectRatio: "16:9",
      aiProvider: "pixazo",
      watermark: false,
      manifest: {
        reservedCredits: admin ? 0 : cost,
        reservedSubscriptionCredits: charged?.subDebit ?? 0,
        reservedTopupCredits: charged?.topDebit ?? 0,
        lipSyncEnabled: true,
        publicLipSync: true,
        sourceVideoId: video.id,
        sourceVideoTitle: video.title ?? "Video",
      } as unknown as Record<string, unknown>,
      progressPercent: 0,
    });

    req.log.info(
      { jobId: lipSyncJobId, sourceVideoId: video.id, lipsyncSeconds, lipsyncStartTime },
      "AI Lip Sync job queued",
    );
    res.status(202).json({ jobId: lipSyncJobId, creditsCharged: admin ? 0 : cost });
  } catch (err) {
    // Queue setup failed before a worker could own the reservation.
    if (charged) {
      await refundCredits(req.user.id, charged.subDebit, charged.topDebit);
    }
    req.log.error({ err, videoId: video.id }, "Lip sync queueing failed");
    res.status(500).json({
      error: "AI Lip Sync could not start. Any reserved credits were returned. Please try again.",
    });
  }
});

// Classifies where a job's ORIGINAL (untrimmed) song audio lives, for the
// "Guided Hybrid Lip Sync Remix" handoff's song-audio resolution below. Pure
// and DB/network-free so it's directly unit-testable.
export type SongSourceClassification =
  | { kind: "stored"; objectPath: string }
  | { kind: "remote"; url: string }
  | { kind: "unavailable" };

export function classifySongSource(
  job: { audioObjectPath?: string | null; audioSourceUrl?: string | null } | null | undefined,
): SongSourceClassification {
  if (job?.audioObjectPath) return { kind: "stored", objectPath: job.audioObjectPath };
  if (job?.audioSourceUrl) return { kind: "remote", url: job.audioSourceUrl };
  return { kind: "unavailable" };
}

// GET /videos/:id/song-audio — resolve a Remix-Lab-usable object storage path
// for this video's ORIGINAL full song (not a Lip Sync trim), for the "Guided
// Hybrid Lip Sync Remix" handoff (LipSyncPanel -> Remix Lab). Cheap when the
// source song is already an uploaded file (job.audioObjectPath); for a
// youtube/suno-imported song (only job.audioSourceUrl, no stored object) it
// downloads and caches a copy, since Remix Lab's render pipeline only accepts
// object storage paths, not arbitrary external URLs. Called on demand (only
// when the user takes the hybrid-insert action), not on every Lip Sync
// request, since most Lip Sync requests never use it.
router.get("/videos/:id/song-audio", async (req: Request<{ id: string }>, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const video = await loadOwnedVideo(req.user.id, req.params.id);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, video.jobId)).limit(1);
  const durationSec =
    (job?.audioAnalysis as { durationSeconds?: number } | null | undefined)?.durationSeconds ?? null;
  const source = classifySongSource(job);

  try {
    if (source.kind === "stored") {
      const url = await storageService.getObjectEntitySignedUrl(source.objectPath, 3600);
      res.json({ objectPath: source.objectPath, durationSec, url });
      return;
    }
    if (source.kind === "remote") {
      const audioResp = await fetch(source.url, { signal: AbortSignal.timeout(60_000) });
      if (!audioResp.ok) throw new Error("Could not read the source audio.");
      const buffer = Buffer.from(await audioResp.arrayBuffer());
      const contentType = audioResp.headers.get("content-type") || "";
      const ext = contentType.includes("wav") ? "wav" : contentType.includes("ogg") ? "ogg" : "mp3";
      const objectPath = await storageService.uploadAudioBuffer(buffer, randomUUID(), ext);
      const url = await storageService.getObjectEntitySignedUrl(objectPath, 3600);
      res.json({ objectPath, durationSec, url });
      return;
    }
    res.status(404).json({
      error: "This video has no source song to use as the hybrid soundtrack.",
      code: "SONG_AUDIO_UNAVAILABLE",
    });
  } catch (err) {
    req.log.error({ err, videoId: video.id }, "Could not resolve song audio for hybrid remix");
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not prepare the song audio." });
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
