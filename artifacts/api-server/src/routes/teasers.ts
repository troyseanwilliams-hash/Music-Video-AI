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
import { TEASER_PACK_COST, CANVAS_EXPORT_COST, LYRIC_OVERLAY_COST } from "../lib/creditCost.js";
import { burnLyricsOnVideo } from "../lib/lyricOverlay.js";
import { extractVideoThumbnail } from "../lib/videoStitcher.js";
import { z } from "zod";

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

async function chargeCredits(userId: string, cost: number): Promise<{ ok: boolean; remaining: number }> {
  let [credits] = await db
    .select()
    .from(creditsTable)
    .where(eq(creditsTable.userId, userId))
    .limit(1);
  if (!credits) {
    [credits] = await db
      .insert(creditsTable)
      .values({ id: randomUUID(), userId })
      .returning();
  }
  if (credits!.creditsRemaining < cost) {
    return { ok: false, remaining: credits!.creditsRemaining };
  }
  // Subscription bucket first, then top-up — same split as other renders.
  await db
    .update(creditsTable)
    .set({
      subscriptionCredits: sql`GREATEST(subscription_credits - ${cost}, 0)`,
      topupCredits: sql`GREATEST(topup_credits - GREATEST(${cost} - subscription_credits, 0), 0)`,
      creditsRemaining: sql`GREATEST(credits_remaining - ${cost}, 0)`,
      creditsUsed: sql`credits_used + ${cost}`,
      updatedAt: new Date(),
    })
    .where(eq(creditsTable.userId, userId));
  return { ok: true, remaining: credits!.creditsRemaining - cost };
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
      await db
        .update(creditsTable)
        .set({
          topupCredits: sql`topup_credits + ${cost}`,
          creditsRemaining: sql`credits_remaining + ${cost}`,
          creditsUsed: sql`GREATEST(credits_used - ${cost}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(creditsTable.userId, req.user.id));
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
const LyricsBody = z.object({ lyricsText: z.string().min(1).max(5000) });

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

    const url = await storageService.getObjectEntitySignedUrl(videoObjectPath, 3600);
    res.json({ videoId: newVideoId, url, charged: LYRIC_OVERLAY_COST });
  } catch (err) {
    await db
      .update(creditsTable)
      .set({
        topupCredits: sql`topup_credits + ${LYRIC_OVERLAY_COST}`,
        creditsRemaining: sql`credits_remaining + ${LYRIC_OVERLAY_COST}`,
        creditsUsed: sql`GREATEST(credits_used - ${LYRIC_OVERLAY_COST}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(creditsTable.userId, req.user.id));
    req.log.error({ err, videoId: video.id }, "Lyric overlay failed (refunded)");
    res.status(500).json({ error: "Lyric burn failed — credits refunded. Please try again." });
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
