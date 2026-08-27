import { Router } from "express";
import https from "https";
import { Client } from "pg";
import { db } from "@workspace/db";
import { jobsTable, creditsTable, usersTable, videosTable } from "@workspace/db";
import type { VideoClipMeta } from "@workspace/db";
import { eq, and, desc, count, isNull, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  CreateJobBody,
  ListJobsQueryParams,
  GetJobParams,
} from "@workspace/api-zod";
import {
  calculateCreditCost,
  calculateGeneratedImageCost,
  calculateLipsyncCost,
  calculateRemixCost,
  getClipPlan,
  LYRIC_OVERLAY_COST,
  MAX_FULL_SECONDS,
} from "../lib/creditCost.js";
import { getUserTier, canRender4k } from "../lib/tier.js";
import { planShots } from "../lib/shotPlan.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { MAX_LYRICS_LENGTH } from "../lib/lyricLimits.js";
import { verifyAudioAnalysisReceipt } from "../lib/audioAnalysisReceipt.js";
import { toCustomerJobView } from "../lib/customerJobView.js";

const router = Router();

// Shape of the billing/salvage state we stash in an AI job's manifest jsonb.
type AiJobMeta = {
  reservedCredits?: number;
  reservedSubscriptionCredits?: number;
  reservedTopupCredits?: number;
  refunded?: boolean;
  partialClips?: Record<string, string>;
  bundledLipSyncChildId?: string;
};

// Turn manifest.partialClips (clip index -> raw object storage path, e.g.
// "/objects/clips/job-xxx/2.mp4") into URLs the frontend can drop straight
// into a <video src>, reusing the same /storage/objects/* route that already
// serves thumbnails and finished videos. Lets the job-status page show each
// scene as soon as it's rendered, instead of only after the whole video is
// stitched together.
// Authoritative scene count for the live generation preview grid, computed
// with the SAME formula used for billing (getClipPlan/fullClipCount) and by
// the worker's buildGenerationPlan -- so the preview never under-counts
// relative to what's actually being generated (the bug: the frontend used to
// guess its own numClips with a simplified formula that maxed out around 3
// for "full" jobs, silently truncating the grid for anything longer).
// Only meaningful for the AI generation pipeline -- editor/remix jobs render
// differently and don't have this kind of clip plan.
function resolveScenePlan(job: {
  jobType?: string | null;
  requestedDuration?: string | null;
  audioAnalysis?: unknown;
  manifest?: unknown;
}): { numClips: number } | undefined {
  if (job.jobType && job.jobType !== "ai") return undefined;
  const songDurationSec = (job.audioAnalysis as { durationSeconds?: number } | null | undefined)
    ?.durationSeconds;
  const manifest = job.manifest && typeof job.manifest === "object"
    ? job.manifest as { generationMode?: unknown }
    : {};
  const generationMode = manifest.generationMode === "narrative" ? "narrative" : "montage";
  const { numClips } = getClipPlan(job.requestedDuration, songDurationSec, generationMode);
  return { numClips };
}

function resolvePreviewClips(manifest: unknown): Record<string, string> | undefined {
  const meta = manifest && typeof manifest === "object" ? (manifest as AiJobMeta) : {};
  const partial = meta.partialClips;
  if (!partial || Object.keys(partial).length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const [index, objectPath] of Object.entries(partial)) {
    if (typeof objectPath === "string" && objectPath.startsWith("/objects/")) {
      out[index] = `/api/storage/objects${objectPath.slice("/objects".length)}`;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// Refund a job's up-front credit reservation exactly once. Idempotent via the
// manifest.refunded flag, so cancel/delete/worker-fail can all call it safely.
// Also best-effort deletes any persisted partial clips. Returns credits refunded.
async function refundJobReservation(job: {
  id: string;
  userId: string;
  manifest: unknown;
}): Promise<number> {
  let paths: string[] = [];
  const totalRefund = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ manifest: jobsTable.manifest })
      .from(jobsTable)
      .where(eq(jobsTable.id, job.id))
      .limit(1)
      .for("update");
    const meta: AiJobMeta =
      row?.manifest && typeof row.manifest === "object" ? (row.manifest as AiJobMeta) : {};
    const reserved = meta.reservedCredits ?? 0;
    if (reserved <= 0 || meta.refunded) return 0;
    const hasExactSplit =
      typeof meta.reservedSubscriptionCredits === "number" ||
      typeof meta.reservedTopupCredits === "number";
    const subscriptionRefund = hasExactSplit ? Math.max(0, meta.reservedSubscriptionCredits ?? 0) : reserved;
    const topupRefund = hasExactSplit ? Math.max(0, meta.reservedTopupCredits ?? 0) : 0;
    const total = subscriptionRefund + topupRefund;
    paths = Object.values(meta.partialClips ?? {});

    await tx
      .update(creditsTable)
      .set({
        subscriptionCredits: sql`subscription_credits + ${subscriptionRefund}`,
        topupCredits: sql`topup_credits + ${topupRefund}`,
        creditsRemaining: sql`credits_remaining + ${total}`,
        creditsUsed: sql`GREATEST(credits_used - ${total}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(creditsTable.userId, job.userId));

    await tx
      .update(jobsTable)
      .set({
        manifest: { ...meta, refunded: true, partialClips: {} } as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(jobsTable.id, job.id));
    if (meta.bundledLipSyncChildId) {
      await tx
        .update(jobsTable)
        .set({
          status: "failed",
          errorMessage: "The source video could not be created, so bundled AI Lip Sync was not started.",
          updatedAt: new Date(),
        })
        .where(eq(jobsTable.id, meta.bundledLipSyncChildId));
    }
    return total;
  });

  // Best-effort: drop the salvage copies of any clips this job rendered.
  if (paths.length) {
    const storage = new ObjectStorageService();
    await Promise.all(paths.map((p) => storage.deleteObject(p).catch(() => {})));
  }
  return totalRefund;
}

// Storyboard preview: returns the planned shots (label, timing, energy, prompt)
// for a would-be job so users can approve before spending credits. No render,
// no charge — pure planning that mirrors the worker's generation plan.
router.post("/jobs/preview-shots", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const {
      prompt,
      style,
      character,
      requestedDuration,
      silentFilmDurationSeconds,
      generationMode,
      audioAnalysis,
      audioObjectPath,
    } = (req.body ?? {}) as Record<string, unknown>;
    const analysisReceipt = audioAnalysis && typeof audioAnalysis === "object"
      ? (audioAnalysis as Record<string, unknown>).analysisReceipt
      : null;
    const verifiedAnalysis = typeof audioObjectPath === "string"
      ? verifyAudioAnalysisReceipt({
          userId: req.user.id,
          objectPath: audioObjectPath,
          analysis: audioAnalysis,
          receipt: analysisReceipt,
        })
      : null;
    const previewDuration = audioObjectPath ? requestedDuration : silentFilmDurationSeconds ?? requestedDuration;
    const plan = planShots({
      prompt: prompt as string | null,
      style: style as string | null,
      character: character as string | null,
      requestedDuration: previewDuration as string | null,
      generationMode: generationMode === "narrative" ? "narrative" : "montage",
      analysis: verifiedAnalysis as never,
    });
    res.json(plan);
  } catch (err) {
    req.log.error({ err }, "Shot preview failed");
    res.status(500).json({ error: "Could not build a preview." });
  }
});

// Per-user video capabilities (which resolutions/limits the plan unlocks). Used
// by the Generate page to gate the 4K option to Pro & Studio.
router.get("/jobs/video-capabilities", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [userRecord] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);
  const isAdmin = !!(process.env.ADMIN_EMAIL && userRecord?.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
  const tier = await getUserTier(userRecord ?? {});
  res.json({
    tier,
    isAdmin,
    can4k: isAdmin || canRender4k(tier),
    maxDurationSeconds: 600,
  });
});

router.get("/jobs", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parseResult = ListJobsQueryParams.safeParse(req.query);
  const page = parseResult.success ? (parseResult.data.page ?? 1) : 1;
  const limit = parseResult.success ? (parseResult.data.limit ?? 20) : 20;
  const offset = (page - 1) * limit;

  const [jobs, totalResult] = await Promise.all([
    db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.userId, req.user.id))
      .orderBy(desc(jobsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(jobsTable)
      .where(eq(jobsTable.userId, req.user.id)),
  ]);

  res.json({
    jobs: jobs.map(toCustomerJobView),
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  });
});

router.post("/jobs", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parseResult = CreateJobBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.message });
    return;
  }

  const {
    prompt,
    style,
    audioSourceType,
    audioObjectPath,
    audioSourceUrl,
    lyricsText,
    aspectRatio,
    resolution,
    character,
    referenceImagePath,
    requestedDuration,
    silentFilmDurationSeconds,
    generationMode,
    narrativeVisualSource,
    clipStartTime,
    audioAnalysis,
    aiProvider,
    fullTrackLipSyncEnabled,
    fullTrackLipSyncSeconds,
    fullTrackLipSyncStartTime,
    fullTrackLipSyncImagePath,
  } =
    parseResult.data;
  const normalizedGenerationMode =
    generationMode === "narrative" ? "narrative" : "montage";
  // Every ordinary AI video starts from its planned stills. Keep the submitted
  // value in the request contract for old clients, but image packs remain a
  // separate job type and never come through this route.
  const normalizedNarrativeVisualSource = "generated_images";

  // "No audio" jobs render a silent video (soundtrack added later in the
  // Editor) — there's no audio to attest ownership of, and no song to derive
  // a "full length" from, so both requirements below are skipped for them.
  const noAudio = audioSourceType === "none";
  const resolvedRequestedDuration = noAudio
    ? String(silentFilmDurationSeconds ?? requestedDuration ?? "30")
    : requestedDuration;
  const analysisReceipt = audioAnalysis && typeof audioAnalysis === "object"
    ? (audioAnalysis as Record<string, unknown>).analysisReceipt
    : null;
  const verifiedAudioAnalysis = typeof audioObjectPath === "string"
    ? verifyAudioAnalysisReceipt({
        userId: req.user.id,
        objectPath: audioObjectPath,
        analysis: audioAnalysis,
        receipt: analysisReceipt,
      })
    : null;
  const submittedDuration = (
    verifiedAudioAnalysis as { durationSeconds?: number | null } | null
  )?.durationSeconds;

  if (!noAudio && (req.body as { acceptCopyright?: unknown })?.acceptCopyright !== true) {
    res.status(403).json({
      error: "You must confirm you own or are licensed to use this audio before generating.",
      code: "COPYRIGHT_REQUIRED",
    });
    return;
  }

  if (audioSourceType === "upload" && !audioObjectPath) {
    res
      .status(400)
      .json({ error: "audioObjectPath required for upload source type" });
    return;
  }
  if (
    (audioSourceType === "youtube" || audioSourceType === "suno") &&
    !audioSourceUrl
  ) {
    res
      .status(400)
      .json({ error: "audioSourceUrl required for youtube/suno source type" });
    return;
  }

  const bundledLipSyncEnabled = fullTrackLipSyncEnabled === true;
  const bundledLipSyncSeconds = fullTrackLipSyncSeconds ?? 15;
  const bundledLipSyncStartTime = fullTrackLipSyncStartTime ?? 0;
  if (bundledLipSyncEnabled) {
    if (requestedDuration !== "full" || audioSourceType !== "upload" || !audioObjectPath) {
      res.status(422).json({
        error: "Bundled AI Lip Sync requires a full-track uploaded song.",
        code: "LIPSYNC_FULL_TRACK_REQUIRED",
      });
      return;
    }
    if (!fullTrackLipSyncImagePath) {
      res.status(422).json({
        error: "Upload a face image before adding AI Lip Sync.",
        code: "LIPSYNC_FACE_REQUIRED",
      });
      return;
    }
    if (
      typeof submittedDuration !== "number" ||
      bundledLipSyncStartTime + bundledLipSyncSeconds > submittedDuration + 0.01
    ) {
      res.status(422).json({
        error: "Choose an AI Lip Sync range that ends within the uploaded song.",
        code: "LIPSYNC_RANGE_OUT_OF_BOUNDS",
      });
      return;
    }
  }
  if (noAudio && (!silentFilmDurationSeconds && (!requestedDuration || requestedDuration === "full"))) {
    res.status(400).json({
      error: "Choose a specific length for a no-audio video — there's no song to derive a \"full length\" from.",
    });
    return;
  }

  // A Full track job must be priced and planned from the analysis of the exact
  // uploaded file. This prevents a stale client-side duration from becoming a
  // paid render with an unexpected runtime.
  if (
    !noAudio &&
    (!requestedDuration || requestedDuration === "full") &&
    (!Number.isFinite(submittedDuration) || !submittedDuration || submittedDuration <= 0)
  ) {
    res.status(422).json({
      error: "Audio analysis must finish before creating a full-track video.",
      code: "AUDIO_ANALYSIS_REQUIRED",
    });
    return;
  }
  if (
    !noAudio &&
    (!requestedDuration || requestedDuration === "full") &&
    typeof submittedDuration === "number" &&
    submittedDuration > MAX_FULL_SECONDS
  ) {
    res.status(422).json({
      error: `Full-track videos support audio up to ${Math.floor(MAX_FULL_SECONDS / 60)} minutes. Choose a shorter track or a specific duration.`,
      code: "AUDIO_DURATION_LIMIT_EXCEEDED",
      maxDurationSeconds: MAX_FULL_SECONDS,
    });
    return;
  }

  const [userRecord] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  const isAdmin = !!(process.env.ADMIN_EMAIL && userRecord?.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());

  // Record the consent timestamp (first acceptance) for our compliance records.
  if (!userRecord?.copyrightAcceptedAt) {
    await db.update(usersTable).set({ copyrightAcceptedAt: new Date() }).where(eq(usersTable.id, req.user.id));
  }
  req.log.info({ userId: req.user.id, ip: req.ip }, "Copyright attestation recorded");

  if (!isAdmin) {
    const status = userRecord?.subscriptionStatus ?? "none";
    if (status !== "active") {
      res.status(403).json({
        error: "A subscription is required to create videos.",
        code: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }
  }

  // Resolve the subscription tier once (non-admins): gates 4K and decides the
  // Starter-tier watermark. getUserTier is try/caught (falls open on Stripe error).
  const tier = isAdmin ? null : await getUserTier(userRecord ?? {});

  // 4K is a premium tier — Pro & Studio only (admins always allowed).
  if (!isAdmin && String(resolution ?? "").toLowerCase() === "4k" && !canRender4k(tier)) {
    res.status(403).json({
      error: "4K rendering is available on the Pro and Studio plans. Upgrade to unlock 4K, or choose 1080p.",
      code: "TIER_REQUIRED_4K",
    });
    return;
  }

  // Only NON-paying exports (trial / free — no active subscription) carry the
  // "Made with AIBeatSync · aibeatsync.com" watermark: the shared clip is a free
  // demo and an upgrade incentive. Any paid tier (Starter, Pro, Studio) and
  // admins render clean. getUserTier returns null when there's no paid plan.
  const watermark = !isAdmin && !tier;

  const songDurationSec = (
    verifiedAudioAnalysis as { durationSeconds?: number } | null
  )?.durationSeconds;
  // Kling (via Pixazo) is cheaper than Runway, so the charge scales with the
  // chosen engine. Only "kling" is offered as an alternative for now.
  const engine = String(aiProvider ?? "").toLowerCase() === "kling" ? "kling" : "runway";
  const storyboard = planShots({
    prompt,
    style,
    character,
    requestedDuration: resolvedRequestedDuration,
    generationMode: normalizedGenerationMode,
    analysis: verifiedAudioAnalysis as never,
  });
  if (
    normalizedGenerationMode === "narrative"
    && (
      storyboard.reuseCount !== 0
      || storyboard.shots.length !== storyboard.numClips
      || storyboard.timeline.length !== storyboard.numClips
      || storyboard.timeline.some((entry, index) => entry.visualIndex !== index)
    )
  ) {
    res.status(422).json({
      error: "Could not build a complete chronological story plan. Please adjust the prompt and try again.",
      code: "NARRATIVE_PLAN_INVALID",
    });
    return;
  }
  // Karaoke lyric burn is a paid add-on: generating with lyrics costs the same
  // LYRIC_OVERLAY_COST as burning lyrics onto a finished video, so there's no
  // free path to the same output. Mirror in creditPricing.ts (generate page).
  const lyricAddon = lyricsText?.trim() ? LYRIC_OVERLAY_COST : 0;
  const baseCreditCost =
    calculateCreditCost(
      resolvedRequestedDuration,
      resolution,
      songDurationSec,
      engine,
      normalizedGenerationMode,
    )
    + calculateGeneratedImageCost(
      resolvedRequestedDuration,
      songDurationSec,
      normalizedGenerationMode,
      normalizedNarrativeVisualSource,
    )
    + lyricAddon;
  const bundledLipSyncCost = bundledLipSyncEnabled
    ? calculateLipsyncCost(bundledLipSyncSeconds)
    : 0;
  const creditCost = baseCreditCost + bundledLipSyncCost;

  // Ensure a credits row exists for everyone — admins are metered too (their
  // balance floors at 0 but creditsUsed still tracks the spend).
  const credits = await db
    .select()
    .from(creditsTable)
    .where(eq(creditsTable.userId, req.user.id))
    .limit(1);
  let userCredits = credits[0];
  if (!userCredits) {
    const [newCredits] = await db
      .insert(creditsTable)
      .values({ id: randomUUID(), userId: req.user.id })
      .returning();
    userCredits = newCredits;
  }

  // Reserve (charge) the credits UP FRONT so every paid provider clip is backed
  // by credits. The worker refunds this automatically if the job permanently
  // fails or is canceled. This replaces the old "deduct only on success" model,
  // which let failed/partial multi-clip jobs incur real provider spend while
  // charging the user nothing.
  // Reservation + job insert run in ONE transaction so a failed insert rolls
  // back the exact bucket debits (no lossy compensating update).
  const jobId = randomUUID();
  const bundledLipSyncChildId = bundledLipSyncEnabled ? randomUUID() : null;
  const reservation = await db.transaction(async (tx) => {
    const [lockedCredits] = await tx
      .select()
      .from(creditsTable)
      .where(eq(creditsTable.userId, req.user.id))
      .limit(1)
      .for("update");
    if (!lockedCredits) throw new Error("Credits account unavailable.");
    if (!isAdmin && lockedCredits.creditsRemaining < creditCost) {
      return { job: null, remaining: lockedCredits.creditsRemaining };
    }

    const subscriptionDebit = Math.min(
      creditCost,
      Math.max(0, lockedCredits.subscriptionCredits),
    );
    const topupDebit = Math.min(
      Math.max(0, creditCost - subscriptionDebit),
      Math.max(0, lockedCredits.topupCredits),
    );
    const baseSubscriptionDebit = Math.min(baseCreditCost, subscriptionDebit);
    const baseTopupDebit = Math.min(
      Math.max(0, baseCreditCost - baseSubscriptionDebit),
      topupDebit,
    );
    const lipSyncSubscriptionDebit = Math.max(0, subscriptionDebit - baseSubscriptionDebit);
    const lipSyncTopupDebit = Math.max(0, topupDebit - baseTopupDebit);

    await tx
      .update(creditsTable)
      .set({
        subscriptionCredits: sql`GREATEST(subscription_credits - ${creditCost}, 0)`,
        topupCredits: sql`GREATEST(topup_credits - GREATEST(${creditCost} - subscription_credits, 0), 0)`,
        creditsRemaining: sql`GREATEST(credits_remaining - ${creditCost}, 0)`,
        creditsUsed: sql`credits_used + ${creditCost}`,
        updatedAt: new Date(),
      })
      .where(eq(creditsTable.userId, req.user.id));

    const [inserted] = await tx
      .insert(jobsTable)
      .values({
      id: jobId,
      userId: req.user.id,
      status: "queued",
      // "none" (prompt-only / silent video) is not a value in the DB enum —
      // store null; the processor detects no-audio by the missing audio source.
      audioSourceType: noAudio
        ? null
        : (audioSourceType as "upload" | "youtube" | "suno" | undefined),
      audioObjectPath: audioObjectPath ?? null,
      audioSourceUrl: audioSourceUrl ?? null,
      lyricsText: lyricsText ?? null,
      aspectRatio: aspectRatio ?? null,
      resolution: resolution ?? null,
      character: character ?? null,
      referenceImagePath: referenceImagePath ?? null,
      requestedDuration: resolvedRequestedDuration ?? "full",
      clipStartTime: resolvedRequestedDuration === "full" ? null : (clipStartTime ?? null),
      audioAnalysis: verifiedAudioAnalysis,
      aiProvider: engine,
      watermark,
      // AI jobs stash billing + clip-salvage state in the (otherwise unused)
      // manifest jsonb: reservedCredits is refunded by the worker on failure.
      manifest: {
        reservedCredits: creditCost,
        reservedSubscriptionCredits: subscriptionDebit,
        reservedTopupCredits: topupDebit,
        baseCreditCost,
        baseReservedSubscriptionCredits: baseSubscriptionDebit,
        baseReservedTopupCredits: baseTopupDebit,
        bundledLipSyncEnabled,
        bundledLipSyncCost,
        bundledLipSyncReservedSubscriptionCredits: lipSyncSubscriptionDebit,
        bundledLipSyncReservedTopupCredits: lipSyncTopupDebit,
        generationMode: normalizedGenerationMode,
        narrativeVisualSource: normalizedNarrativeVisualSource,
        imageFirstVersion: 1,
        imageCreditCost: calculateGeneratedImageCost(
          resolvedRequestedDuration,
          songDurationSec,
          normalizedGenerationMode,
          normalizedNarrativeVisualSource,
        ),
        videoCreditCost: calculateCreditCost(
          resolvedRequestedDuration,
          resolution,
          songDurationSec,
          engine,
          normalizedGenerationMode,
        ),
        ...(noAudio ? { silentFilmDurationSeconds: Number(resolvedRequestedDuration) } : {}),
        ...(bundledLipSyncChildId ? { bundledLipSyncChildId } : {}),
        storyboard,
      } as unknown as Record<string, unknown>,
      prompt,
      style: style as
        | "realistic"
        | "anime"
        | "cinematic"
        | "abstract"
        | "neon"
        | "vintage"
        | "fantasy"
        | "documentary"
        | undefined,
      progressPercent: 0,
      })
      .returning();

    if (bundledLipSyncChildId) {
      await tx.insert(jobsTable).values({
        id: bundledLipSyncChildId,
        userId: req.user.id,
        jobType: "runway_lipsync",
        status: "pending_approval",
        prompt: `${prompt} — AI Lip Sync`,
        style: style as
          | "realistic"
          | "anime"
          | "cinematic"
          | "abstract"
          | "neon"
          | "vintage"
          | "fantasy"
          | "documentary"
          | undefined,
        referenceImagePath: fullTrackLipSyncImagePath,
        audioSourceType: "upload",
        audioObjectPath,
        clipStartTime: bundledLipSyncStartTime,
        requestedDuration: String(bundledLipSyncSeconds),
        aspectRatio: aspectRatio ?? "16:9",
        aiProvider: "pixazo",
        watermark: false,
        manifest: {
          reservedCredits: 0,
          lipSyncEnabled: true,
          publicLipSync: true,
          bundledLipSync: true,
          bundledParentJobId: jobId,
          bundledLipSyncCost,
          bundledLipSyncReservedSubscriptionCredits: lipSyncSubscriptionDebit,
          bundledLipSyncReservedTopupCredits: lipSyncTopupDebit,
          sourceVideoTitle: prompt.slice(0, 100),
        } as unknown as Record<string, unknown>,
        progressPercent: 0,
      });
    }
    return { job: inserted, remaining: lockedCredits.creditsRemaining - creditCost };
  });

  if (!reservation.job) {
    res.status(402).json({
      error: `Insufficient credits — this bundle costs ${creditCost} credits but you only have ${reservation.remaining} remaining.`,
      code: "INSUFFICIENT_CREDITS",
      creditsRequired: creditCost,
      creditsRemaining: reservation.remaining,
    });
    return;
  }
  const job = reservation.job;

  req.log.info(
    { userId: req.user.id, requestedDuration, baseCreditCost, bundledLipSyncCost, creditCost, isAdmin },
    "Job queued — credits reserved up front (refunded automatically on failure)",
  );

  res.status(201).json(toCustomerJobView(job));
});

router.get("/jobs/:id", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parseResult = GetJobParams.safeParse(req.params);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const job = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.id, parseResult.data.id),
        eq(jobsTable.userId, req.user.id),
      ),
    )
    .limit(1);

  if (!job[0]) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const jobData: Record<string, unknown> = { ...toCustomerJobView(job[0]) };
  const previewClips = resolvePreviewClips(job[0].manifest);
  if (previewClips) jobData.previewClips = previewClips;
  const scenePlan = resolveScenePlan(job[0]);
  if (scenePlan) jobData.scenePlan = scenePlan;
  if (job[0].videoId && job[0].status === "ready") {
    const storageService = new ObjectStorageService();
    jobData.videoUrl = await storageService.getVideoSignedUrl(job[0].videoId);

    // Surface the per-clip metadata so the remix UI can list individual clips,
    // and hasAudio so job-status can offer "Add Music" for a silent render.
    const [video] = await db
      .select({ clips: videosTable.clips, durationSeconds: videosTable.durationSeconds, hasAudio: videosTable.hasAudio })
      .from(videosTable)
      .where(eq(videosTable.id, job[0].videoId))
      .limit(1);
    if (video?.clips) jobData.clips = video.clips;
    if (video) jobData.hasAudio = video.hasAudio;
  }
  res.json(jobData);
});

router.get("/jobs/:id/events", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const jobId = req.params.id;

  const existing = await db
    .select()
    .from(jobsTable)
    .where(
      and(eq(jobsTable.id, jobId), eq(jobsTable.userId, req.user.id)),
    )
    .limit(1);

  if (!existing[0]) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendJob = (job: typeof existing[0]) => {
    const previewClips = resolvePreviewClips(job.manifest);
    const scenePlan = resolveScenePlan(job);
    const payload = toCustomerJobView({
      ...job,
      ...(previewClips ? { previewClips } : {}),
      ...(scenePlan ? { scenePlan } : {}),
    });
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendJob(existing[0]);

  if (existing[0].status === "ready" || existing[0].status === "failed") {
    res.end();
    return;
  }

  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  let pgConnected = false;
  let ended = false;

  try {
    await pgClient.connect();
    pgConnected = true;
    const channel = `job_${jobId.replace(/-/g, "_")}`;
    await pgClient.query(`LISTEN "${channel}"`);

    pgClient.on("notification", async () => {
      if (ended) return;
      try {
        const [updated] = await db
          .select()
          .from(jobsTable)
          .where(eq(jobsTable.id, jobId))
          .limit(1);
        if (updated) {
          sendJob(updated);
          if (updated.status === "ready" || updated.status === "failed") {
            ended = true;
            await pgClient.end().catch(() => {});
            res.end();
          }
        }
      } catch {
      }
    });

    pgClient.on("error", () => {
    });
  } catch {
    pgConnected = false;
  }

  const heartbeat = setInterval(() => {
    if (!ended) res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", async () => {
    ended = true;
    clearInterval(heartbeat);
    if (pgConnected) {
      await pgClient.end().catch(() => {});
    }
  });
});

router.get("/jobs/:id/video", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const jobId = req.params.id;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(
      and(eq(jobsTable.id, jobId), eq(jobsTable.userId, req.user.id)),
    )
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!job.videoId) {
    res.status(404).json({ error: "Video not ready yet" });
    return;
  }

  const storageService = new ObjectStorageService();
  const signedUrl = await storageService.getVideoSignedUrl(job.videoId);
  res.redirect(302, signedUrl);
});

// Proxy the video through the server with Content-Disposition so browsers download it
router.get("/jobs/:id/video/download", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const jobId = req.params.id;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(
      and(eq(jobsTable.id, jobId), eq(jobsTable.userId, req.user.id)),
    )
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!job.videoId) {
    res.status(404).json({ error: "Video not ready yet" });
    return;
  }

  const storageService = new ObjectStorageService();
  const signedUrl = await storageService.getVideoSignedUrl(job.videoId);

  // Stream via native https — avoids Readable.fromWeb and AbortSignal issues
  await new Promise<void>((resolve, reject) => {
    https.get(signedUrl, (upstream) => {
      if (upstream.statusCode !== 200) {
        upstream.resume();
        res.status(502).json({ error: "Failed to fetch video from storage" });
        resolve();
        return;
      }
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="beatvision-${job.id}.mp4"`);
      const cl = upstream.headers["content-length"];
      if (cl) res.setHeader("Content-Length", cl);
      upstream.pipe(res);
      upstream.on("end", resolve);
      upstream.on("error", (err) => {
        req.log.error({ err }, "Video download upstream error");
        if (!res.headersSent) res.status(500).json({ error: "Stream error" });
        else res.destroy();
        resolve();
      });
      res.on("close", () => { upstream.destroy(); resolve(); });
    }).on("error", (err) => {
      req.log.error({ err }, "Video download request error");
      if (!res.headersSent) res.status(500).json({ error: "Stream error" });
      resolve();
    });
  });
});

router.get("/jobs/:id/video-url", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const jobId = req.params.id;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(
      and(eq(jobsTable.id, jobId), eq(jobsTable.userId, req.user.id)),
    )
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!job.videoId) {
    res.status(404).json({ error: "Video not ready yet" });
    return;
  }

  // Deny playback if the video has been soft-deleted.
  const [vid] = await db
    .select({ deletedAt: videosTable.deletedAt })
    .from(videosTable)
    .where(eq(videosTable.id, job.videoId))
    .limit(1);
  if (!vid || vid.deletedAt) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const storageService = new ObjectStorageService();
  const url = await storageService.getVideoSignedUrl(job.videoId);
  res.json({ url });
});

router.post("/jobs/:id/retry", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const jobId = req.params.id;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(
      and(eq(jobsTable.id, jobId), eq(jobsTable.userId, req.user.id)),
    )
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const retryMeta =
    job.manifest && typeof job.manifest === "object"
      ? (job.manifest as {
          refunded?: boolean;
          bundledLipSyncEnabled?: boolean;
          bundledLipSyncActivated?: boolean;
          uncertainSubmissions?: Record<string, unknown>;
        })
      : {};
  if (
    retryMeta.refunded ||
    (retryMeta.bundledLipSyncEnabled && !retryMeta.bundledLipSyncActivated)
  ) {
    res.status(409).json({
      error: "This job's credit reservation was returned. Start a new generation to try again.",
      code: "RESERVATION_REFUNDED",
    });
    return;
  }

  if (job.status !== "failed") {
    res.status(400).json({ error: "Only failed jobs can be retried" });
    return;
  }
  if (job.jobType === "runway_lipsync") {
    res.status(409).json({
      error: "AI Lip Sync jobs cannot be retried automatically. Start a new Lip Sync request instead.",
    });
    return;
  }

  const acknowledgeUncertainSubmission =
    req.body?.acknowledgeUncertainSubmission === true;
  const hasPersistedUncertainty =
    Object.keys(retryMeta.uncertainSubmissions ?? {}).length > 0;
  // Backward compatibility for failures recorded before uncertainSubmissions
  // existed. These messages all mean submission ended without a request id.
  const hasLegacyUncertainty =
    /aborted due to timeout|ai service 5\d\d|pixazo 5\d\d|internal server error/i.test(
      job.errorMessage ?? "",
    );
  if (
    (hasPersistedUncertainty || hasLegacyUncertainty) &&
    !acknowledgeUncertainSubmission
  ) {
    res.status(409).json({
      error: "This generation cannot be resubmitted right now.",
      code: "RETRY_UNAVAILABLE",
    });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({
      status: "queued",
      progressPercent: 0,
      errorMessage: null,
      retryCount: 0,
      claimedAt: null,
      manifest: sql`COALESCE(${jobsTable.manifest}, '{}'::jsonb) - 'uncertainSubmissions'`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobsTable.id, jobId),
        eq(jobsTable.userId, req.user.id),
        eq(jobsTable.status, "failed"),
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({
      error: "This job was already resubmitted or is no longer in a failed state.",
      code: "JOB_ALREADY_RESUBMITTED",
    });
    return;
  }

  res.json(toCustomerJobView(updated));
});

// DELETE /api/jobs/:id — remove a user's own job. Restricted to terminal
// states (failed jobs) so a running/queued job can't be yanked mid-flight.
// Jobs that produced a video should be deleted via the video endpoint instead.
router.delete("/jobs/:id", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const jobId = req.params.id;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.userId, req.user.id)))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const deleteMeta =
    job.manifest && typeof job.manifest === "object"
      ? (job.manifest as { bundledParentJobId?: string })
      : {};
  if (deleteMeta.bundledParentJobId) {
    res.status(409).json({
      error: "This bundled AI Lip Sync job is managed with its source video and cannot be deleted separately.",
      code: "BUNDLED_LIPSYNC_MANAGED",
    });
    return;
  }
  if (job.status !== "failed") {
    res.status(400).json({ error: "Only failed generations can be deleted from here." });
    return;
  }

  // Make sure a failed job's reservation is refunded before we drop the row
  // (idempotent — a no-op if the worker already refunded it).
  const refunded = await refundJobReservation(job);
  await db.delete(jobsTable).where(eq(jobsTable.id, jobId));
  req.log.info({ jobId, userId: req.user.id, refunded }, "User deleted failed job");
  res.json({ ok: true });
});

// Cancel one of the user's in-progress jobs (e.g. a stuck/long-running render).
router.post("/jobs/:id/cancel", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const jobId = req.params.id;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.userId, req.user.id)))
    .limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const cancelMeta =
    job.manifest && typeof job.manifest === "object"
      ? (job.manifest as { bundledParentJobId?: string })
      : {};
  if (cancelMeta.bundledParentJobId) {
    res.status(409).json({
      error: "This bundled AI Lip Sync job starts with its source video and cannot be canceled separately.",
      code: "BUNDLED_LIPSYNC_MANAGED",
    });
    return;
  }
  const IN_PROGRESS = ["pending_approval", "queued", "analyzing", "generating", "stitching"] as const;
  if (!IN_PROGRESS.some((status) => status === job.status)) {
    res.status(400).json({ error: "This job isn't running." });
    return;
  }
  const [canceled] = await db
    .update(jobsTable)
    .set({ status: "failed", errorMessage: "Canceled by you", claimedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(jobsTable.id, jobId),
        eq(jobsTable.userId, req.user.id),
        inArray(jobsTable.status, IN_PROGRESS),
      ),
    )
    .returning();
  if (!canceled) {
    res.status(409).json({ error: "This job finished before it could be canceled." });
    return;
  }
  // Refund the up-front reservation for the canceled job.
  const refunded = await refundJobReservation(canceled);
  req.log.info({ jobId, userId: req.user.id, refunded }, "User canceled job");
  res.json({ ok: true, refunded });
});

const RemixBody = z.object({
  clipIndexes: z.array(z.number().int().min(0)).min(1).max(64),
  style: z
    .enum([
      "realistic", "anime", "cinematic", "abstract",
      "neon", "vintage", "fantasy", "documentary",
    ])
    .optional(),
  promptOverride: z.string().max(1000).optional(),
  // Optional karaoke captions burned into the remixed video. When omitted the
  // original job's lyrics are inherited; an empty string clears them.
  lyricsText: z.string().max(MAX_LYRICS_LENGTH).optional(),
  acceptCopyright: z.boolean().optional(),
}).refine(
  (b) => !b.lyricsText?.trim() || b.acceptCopyright === true,
  { message: "You must confirm you have the rights to this song and its lyrics.", path: ["acceptCopyright"] },
);

// POST /api/jobs/:id/remix — regenerate selected clips of a finished video and
// re-stitch into a NEW video. Credits are charged proportionally to the number
// of clips regenerated, not the full job.
router.post("/jobs/:id/remix", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = RemixBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { clipIndexes, style, promptOverride, lyricsText, acceptCopyright } = parsed.data;

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, req.params.id), eq(jobsTable.userId, req.user.id)))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "ready" || !job.videoId) {
    res.status(400).json({ error: "Only completed videos can be remixed." });
    return;
  }

  // Rights attestation must cover the EFFECTIVE lyrics — including lyrics
  // inherited from the original job when the request omits lyricsText.
  const effectiveLyrics = lyricsText !== undefined ? (lyricsText.trim() || null) : job.lyricsText;
  if (effectiveLyrics && acceptCopyright !== true) {
    res.status(400).json({
      error: "This remix will burn lyrics into the video — you must confirm you have the rights to this song and its lyrics.",
      code: "COPYRIGHT_NOT_ACCEPTED",
    });
    return;
  }

  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(
      eq(videosTable.id, job.videoId),
      eq(videosTable.userId, req.user.id),
      isNull(videosTable.deletedAt),
    ))
    .limit(1);

  const clips = (video?.clips as unknown as VideoClipMeta[] | null) ?? [];
  if (!clips.length) {
    res.status(400).json({
      error: "This video has no remixable clips (it was generated before remix was available).",
      code: "NO_REMIXABLE_CLIPS",
    });
    return;
  }

  // De-dupe and validate the selected indexes against what actually exists.
  const validIndexes = Array.from(new Set(clipIndexes)).filter(
    (i) => i >= 0 && i < clips.length,
  );
  if (!validIndexes.length) {
    res.status(400).json({ error: "No valid clip selected to remix." });
    return;
  }

  const [userRecord] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  const isAdmin = !!(
    process.env.ADMIN_EMAIL &&
    userRecord?.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );

  if (!isAdmin && (userRecord?.subscriptionStatus ?? "none") !== "active") {
    res.status(403).json({
      error: "A subscription is required to remix videos.",
      code: "SUBSCRIPTION_REQUIRED",
    });
    return;
  }

  // Lyric burn is a paid add-on here too: a remix whose output carries burned
  // karaoke captions (entered OR inherited from the original job) is charged
  // LYRIC_OVERLAY_COST on top, so remixing isn't a free path to a lyric burn.
  const sourceManifest = job.manifest && typeof job.manifest === "object"
    ? job.manifest as { generationMode?: unknown }
    : {};
  const sourceGenerationMode =
    sourceManifest.generationMode === "narrative" ? "narrative" : "montage";
  const sourceSongDurationSec =
    (job.audioAnalysis as { durationSeconds?: number } | null | undefined)?.durationSeconds;
  const remixLyricAddon = effectiveLyrics?.trim() ? LYRIC_OVERLAY_COST : 0;
  const remixCost =
    calculateRemixCost(
      job.requestedDuration,
      clips.length,
      validIndexes.length,
      job.resolution,
      sourceSongDurationSec,
      job.aiProvider,
      sourceGenerationMode,
    ) + remixLyricAddon;
  const chargeCredits = !isAdmin;

  if (chargeCredits) {
    let [userCredits] = await db
      .select()
      .from(creditsTable)
      .where(eq(creditsTable.userId, req.user.id))
      .limit(1);
    if (!userCredits) {
      [userCredits] = await db
        .insert(creditsTable)
        .values({ id: randomUUID(), userId: req.user.id })
        .returning();
    }
    if (userCredits.creditsRemaining < remixCost) {
      res.status(402).json({
        error: `Remixing ${validIndexes.length} clip(s) costs ${remixCost} credits but you only have ${userCredits.creditsRemaining}.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: remixCost,
        creditsRemaining: userCredits.creditsRemaining,
      });
      return;
    }
  }

  const remixJobId = randomUUID();
  const [remixJob] = await db
    .insert(jobsTable)
    .values({
      id: remixJobId,
      userId: req.user.id,
      jobType: "remix",
      status: "queued", // straight into the worker queue — no AI approval step
      // Inherit the original job's audio + framing so the stitcher reproduces it.
      audioSourceType: job.audioSourceType,
      audioObjectPath: job.audioObjectPath,
      audioSourceUrl: job.audioSourceUrl,
      // Caller-provided lyrics win; empty string clears; omitted inherits.
      lyricsText: effectiveLyrics,
      aspectRatio: job.aspectRatio,
      resolution: job.resolution,
      requestedDuration: job.requestedDuration,
      prompt: promptOverride?.trim() || job.prompt,
      style: (style ?? job.style) as typeof job.style,
      manifest: {
        generationMode: sourceGenerationMode,
        originalVideoId: job.videoId,
        clipIndexes: validIndexes,
        style: style ?? null,
        promptOverride: promptOverride?.trim() || null,
        remixCost,
        chargeCredits,
      } as unknown as Record<string, unknown>,
      progressPercent: 0,
    })
    .returning();

  req.log.info(
    { userId: req.user.id, remixJobId, originalVideoId: job.videoId, clips: validIndexes.length, remixCost, isAdmin },
    "Remix job queued",
  );

  res.status(201).json({ job: remixJob, remixCost, charged: chargeCredits });
});

export default router;
