import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, creditsTable, usersTable } from "@workspace/db";
import { eq, and, gte, ne, count, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { FREE_EDITOR_EXPORTS_PER_MONTH, EDITOR_OVERAGE_COST, TRIAL_LYRIC_EXPORTS } from "../lib/editorCost.js";
import { LYRIC_OVERLAY_COST, LYRIC_ALIGN_COST, TRIAL_FREE_ALIGNS } from "../lib/creditCost.js";
import { MAX_LYRICS_LENGTH } from "../lib/lyricLimits.js";

const router = Router();

const SegmentSchema = z.object({
  objectPath: z.string().min(1),
  kind: z.enum(["video", "photo"]),
  durationSec: z.number().positive().max(600),
  // Trim seconds off the front / back of a video clip (ignored for photos).
  trimStart: z.number().min(0).max(600).optional(),
  trimEnd: z.number().min(0).max(600).optional(),
});

function effectiveSegmentDuration(segment: z.infer<typeof SegmentSchema>) {
  const duration = segment.durationSec;
  if (segment.kind !== "video") return duration;
  const minimumKept = Math.min(0.3, duration);
  const maximumTotalTrim = Math.max(0, duration - minimumKept);
  const front = Math.min(segment.trimStart ?? 0, maximumTotalTrim);
  const back = Math.min(segment.trimEnd ?? 0, Math.max(0, maximumTotalTrim - front));
  return Math.max(minimumKept, duration - front - back);
}

const RenderSchema = z.object({
  name: z.string().max(120).optional(),
  segments: z.array(SegmentSchema).min(1).max(500),
  music: z
    .object({
      objectPath: z.string().min(1),
      mode: z.enum(["mix", "replace"]).default("mix"),
      volume: z.number().min(0).max(1).default(0.6),
      loop: z.boolean().optional(),
      fade: z.boolean().optional(),
    })
    .optional(),
  transition: z
    .object({
      // Full transition set (see the worker's XFADE map). Legacy/unknown values
      // still validate and are treated as a hard cut on render.
      type: z.enum([
        "none", "crossfade", "fadeblack", "fadewhite", "dissolve", "pixelize",
        "wipeleft", "wiperight", "wipeup", "wipedown",
        "slideleft", "slideright", "slideup", "slidedown",
        "circleopen", "circleclose", "radial",
        // legacy values kept for backwards compatibility (render as hard cut)
        "wipe", "slide", "circle", "zoomin",
      ]),
      durationSec: z.number().min(0.2).max(2).default(0.5),
    })
    .optional(),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
  acceptCopyright: z.boolean().optional(),
  // Karaoke lyric burn (same engine as the generator): plain text, LRC, or
  // word-level enhanced LRC.
  lyricsText: z.string().max(MAX_LYRICS_LENGTH).optional(),
});

// GET /api/studio/quota — this month's free-Remix usage for the current user.
router.get("/studio/quota", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [{ used }] = await db
    .select({ used: count() })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.userId, req.user.id),
        eq(jobsTable.jobType, "editor_render"),
        gte(jobsTable.createdAt, monthStart),
        ne(jobsTable.status, "failed"),
      ),
    );
  // Trial karaoke allowance (see /studio/render): only meaningful for
  // non-subscribed users inside their 7-day trial.
  const [quotaUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);
  const quotaTrialActive =
    !!quotaUser?.trialEndsAt &&
    new Date(quotaUser.trialEndsAt).getTime() > Date.now() &&
    (quotaUser?.subscriptionStatus ?? "none") !== "active";
  let lyricUsed = 0;
  if (quotaTrialActive) {
    const [{ used: lu }] = await db
      .select({ used: count() })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.userId, req.user.id),
          eq(jobsTable.jobType, "editor_render"),
          ne(jobsTable.status, "failed"),
          sql`coalesce(${jobsTable.manifest} ->> 'lyricsText', '') <> ''`,
        ),
      );
    lyricUsed = lu;
  }

  res.json({
    used,
    free: FREE_EDITOR_EXPORTS_PER_MONTH,
    remaining: Math.max(0, FREE_EDITOR_EXPORTS_PER_MONTH - used),
    overageCost: EDITOR_OVERAGE_COST,
    trial: quotaTrialActive
      ? {
          lyricUsed,
          lyricFree: TRIAL_LYRIC_EXPORTS,
          lyricRemaining: Math.max(0, TRIAL_LYRIC_EXPORTS - lyricUsed),
          lyricOverageCost: LYRIC_OVERLAY_COST,
          alignUsed: quotaUser?.trialAlignsUsed ?? 0,
          alignFree: TRIAL_FREE_ALIGNS,
          alignRemaining: Math.max(0, TRIAL_FREE_ALIGNS - (quotaUser?.trialAlignsUsed ?? 0)),
          alignCost: LYRIC_ALIGN_COST,
        }
      : null,
  });
});

// POST /api/studio/render — enqueue an editor_render job from a timeline manifest.
router.post("/studio/render", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = RenderSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path?.length ? ` (${first.path.join(".")})` : "";
    res.status(400).json({ error: `${first?.message ?? "Invalid render request"}${where}` });
    return;
  }
  const input = parsed.data;

  // Require the copyright/ownership attestation before rendering uploaded clips.
  if (input.acceptCopyright !== true) {
    res.status(403).json({
      error: "You must confirm you own or are licensed to use these clips before exporting.",
      code: "COPYRIGHT_REQUIRED",
    });
    return;
  }

  const [userRecord] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  if (!userRecord?.copyrightAcceptedAt) {
    await db.update(usersTable).set({ copyrightAcceptedAt: new Date() }).where(eq(usersTable.id, req.user.id));
  }
  req.log.info({ userId: req.user.id, ip: req.ip }, "Copyright attestation recorded (editor)");

  const isAdmin = !!(
    process.env.ADMIN_EMAIL &&
    userRecord?.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
  const isSubscribed = (userRecord?.subscriptionStatus ?? "none") === "active";
  const trialActive =
    !!userRecord?.trialEndsAt && new Date(userRecord.trialEndsAt).getTime() > Date.now();
  // Full, free Editor access during the 7-day trial, with a subscription, or for admins.
  const fullAccess = isAdmin || isSubscribed || trialActive;

  // Remix Lab exports stay CLEAN (no watermark) — it's a headline advantage over
  // CapCut, whose free tier stamps one on. The viral "Made with AIBeatSync"
  // watermark lives on the AI *video generator* exports instead (see jobs.ts).
  const watermarkEditor = false;

  const resolution = input.resolution;
  const transition = input.transition;
  const totalDuration = input.segments.reduce((sum, segment) => sum + effectiveSegmentDuration(segment), 0);

  // Freemium Remix Lab: admins/subscribers/trial are unlimited. Everyone else
  // gets FREE_EDITOR_EXPORTS_PER_MONTH free exports per calendar month, then a
  // flat low overage per export.
  const lyricsRequested = !!input.lyricsText?.trim();
  const userId = req.user.id;

  // Quota counting, balance checks, and job insertion run in ONE transaction
  // serialized per-user with an advisory lock, so two simultaneous submissions
  // can't both grab the last free slot or double-spend the same balance.
  type Rejection = { status: number; body: Record<string, unknown> };
  let rejection: Rejection | null = null;
  let chargeCredits = false;
  let chargeAmount = 0;

  const job = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const loadCredits = async () => {
      let [userCredits] = await tx
        .select()
        .from(creditsTable)
        .where(eq(creditsTable.userId, userId))
        .limit(1);
      if (!userCredits) {
        [userCredits] = await tx
          .insert(creditsTable)
          .values({ id: randomUUID(), userId })
          .returning();
      }
      return userCredits;
    };

    // Trial karaoke allowance: lyric burns cost real money, so trial users get
    // TRIAL_LYRIC_EXPORTS free lyric-burn exports. Beyond that, the standard
    // lyric add-on is charged from their credit balance.
    if (lyricsRequested && trialActive && !isAdmin && !isSubscribed) {
      const [{ used: lyricUsed }] = await tx
        .select({ used: count() })
        .from(jobsTable)
        .where(
          and(
            eq(jobsTable.userId, userId),
            eq(jobsTable.jobType, "editor_render"),
            ne(jobsTable.status, "failed"),
            sql`coalesce(${jobsTable.manifest} ->> 'lyricsText', '') <> ''`,
          ),
        );

      if (lyricUsed >= TRIAL_LYRIC_EXPORTS) {
        chargeCredits = true;
        chargeAmount = LYRIC_OVERLAY_COST;
        const userCredits = await loadCredits();
        if (userCredits.creditsRemaining < chargeAmount) {
          rejection = {
            status: 402,
            body: {
              error: `Your free trial includes ${TRIAL_LYRIC_EXPORTS} karaoke lyric exports and you've used them all. Extra lyric exports cost ${chargeAmount} credits (you have ${userCredits.creditsRemaining}) — or subscribe for unlimited karaoke videos.`,
              code: "TRIAL_LYRIC_LIMIT",
              creditsRequired: chargeAmount,
              creditsRemaining: userCredits.creditsRemaining,
              trialLyricLimit: TRIAL_LYRIC_EXPORTS,
            },
          };
          return null;
        }
      }
    }

    if (!fullAccess) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      // Count this month's editor renders (exclude failed so a broken render
      // doesn't burn a free slot).
      const [{ used }] = await tx
        .select({ used: count() })
        .from(jobsTable)
        .where(
          and(
            eq(jobsTable.userId, userId),
            eq(jobsTable.jobType, "editor_render"),
            gte(jobsTable.createdAt, monthStart),
            ne(jobsTable.status, "failed"),
          ),
        );

      if (used >= FREE_EDITOR_EXPORTS_PER_MONTH) {
        chargeCredits = true;
        chargeAmount = EDITOR_OVERAGE_COST;
        const userCredits = await loadCredits();
        if (userCredits.creditsRemaining < chargeAmount) {
          rejection = {
            status: 402,
            body: {
              error: `You've used your ${FREE_EDITOR_EXPORTS_PER_MONTH} free Remix exports this month. Each extra export is ${chargeAmount} credits (you have ${userCredits.creditsRemaining}). Subscribe for unlimited editing.`,
              code: "FREE_EXPORTS_USED",
              creditsRequired: chargeAmount,
              creditsRemaining: userCredits.creditsRemaining,
            },
          };
          return null;
        }
      }
    }

    const manifest = {
      segments: input.segments,
      music: input.music,
      transition,
      resolution,
      orientation: input.orientation,
      // Free-tier Remix exports carry the "Made with AIBeatSync" watermark; only
      // Pro/Studio (and admins) render clean. Same rule as the video generator.
      watermark: watermarkEditor,
      chargeCredits,
      chargeAmount,
      lyricsText: input.lyricsText?.trim() || null,
    };

    const [inserted] = await tx
      .insert(jobsTable)
      .values({
        id: randomUUID(),
        userId,
        jobType: "editor_render",
        manifest: manifest as unknown as Record<string, unknown>,
        status: "queued", // straight into the worker queue — no AI approval step
        prompt: input.name ?? "Studio export",
        progressPercent: 0,
      })
      .returning();
    return inserted;
  });

  if (!job) {
    const r: Rejection = rejection ?? { status: 500, body: { error: "Failed to queue render" } };
    res.status(r.status).json(r.body);
    return;
  }

  // Estimate shown to the client (0 when the export is free).
  const creditCost = chargeAmount;
  const jobId = job.id;

  req.log.info(
    { userId: req.user.id, jobId, totalDuration, creditCost, fullAccess, trialActive },
    "Editor render queued",
  );

  res.status(201).json({ job, estimatedCost: creditCost, charged: chargeCredits });
});

export default router;
