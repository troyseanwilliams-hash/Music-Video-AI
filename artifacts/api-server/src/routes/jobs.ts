import { Router } from "express";
import https from "https";
import { Client } from "pg";
import { db } from "@workspace/db";
import { jobsTable, creditsTable, usersTable, videosTable } from "@workspace/db";
import type { VideoClipMeta } from "@workspace/db";
import { eq, and, desc, count, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  CreateJobBody,
  ListJobsQueryParams,
  GetJobParams,
} from "@workspace/api-zod";
import { calculateCreditCost, calculateRemixCost } from "../lib/creditCost.js";
import { getUserTier, canRender4k } from "../lib/tier.js";
import { planShots } from "../lib/shotPlan.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();

// Shape of the billing/salvage state we stash in an AI job's manifest jsonb.
type AiJobMeta = {
  reservedCredits?: number;
  refunded?: boolean;
  partialClips?: Record<string, string>;
};

// Turn manifest.partialClips (clip index -> raw object storage path, e.g.
// "/objects/clips/job-xxx/2.mp4") into URLs the frontend can drop straight
// into a <video src>, reusing the same /storage/objects/* route that already
// serves thumbnails and finished videos. Lets the job-status page show each
// scene as soon as it's rendered, instead of only after the whole video is
// stitched together.
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
  const meta: AiJobMeta =
    job.manifest && typeof job.manifest === "object" ? (job.manifest as AiJobMeta) : {};
  const reserved = meta.reservedCredits ?? 0;
  if (reserved <= 0 || meta.refunded) return 0;

  await db
    .update(creditsTable)
    .set({
      subscriptionCredits: sql`subscription_credits + ${reserved}`,
      creditsRemaining: sql`credits_remaining + ${reserved}`,
      creditsUsed: sql`GREATEST(credits_used - ${reserved}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(creditsTable.userId, job.userId));

  await db
    .update(jobsTable)
    .set({ manifest: { ...meta, refunded: true, partialClips: {} } as unknown as Record<string, unknown> })
    .where(eq(jobsTable.id, job.id));

  // Best-effort: drop the salvage copies of any clips this job rendered.
  const paths = Object.values(meta.partialClips ?? {});
  if (paths.length) {
    const storage = new ObjectStorageService();
    await Promise.all(paths.map((p) => storage.deleteObject(p).catch(() => {})));
  }
  return reserved;
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
    const { prompt, style, character, requestedDuration, audioAnalysis } = (req.body ?? {}) as Record<string, unknown>;
    const plan = planShots({
      prompt: prompt as string | null,
      style: style as string | null,
      character: character as string | null,
      requestedDuration: requestedDuration as string | null,
      analysis: (audioAnalysis ?? null) as never,
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
    jobs,
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

  const { prompt, style, audioSourceType, audioObjectPath, audioSourceUrl, lyricsText, aspectRatio, resolution, character, referenceImagePath, requestedDuration, clipStartTime, audioAnalysis, aiProvider } =
    parseResult.data;

  // "No audio" jobs render a silent video (soundtrack added later in the
  // Editor) — there's no audio to attest ownership of, and no song to derive
  // a "full length" from, so both requirements below are skipped for them.
  const noAudio = audioSourceType === "none";

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
  if (noAudio && (!requestedDuration || requestedDuration === "full")) {
    res.status(400).json({
      error: "Choose a specific length for a no-audio video — there's no song to derive a \"full length\" from.",
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

  const songDurationSec = (audioAnalysis as { durationSeconds?: number } | null | undefined)?.durationSeconds;
  // Kling (via Pixazo) is cheaper than Runway, so the charge scales with the
  // chosen engine. Only "kling" is offered as an alternative for now.
  const engine = String(aiProvider ?? "").toLowerCase() === "kling" ? "kling" : "runway";
  const creditCost = calculateCreditCost(requestedDuration, resolution, songDurationSec, engine);

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

  // Non-admins must have the credits before we spend a cent at the provider.
  if (!isAdmin && userCredits.creditsRemaining < creditCost) {
    res.status(402).json({
      error: `Insufficient credits — this job costs ${creditCost} credits but you only have ${userCredits.creditsRemaining} remaining.`,
      code: "INSUFFICIENT_CREDITS",
      creditsRequired: creditCost,
      creditsRemaining: userCredits.creditsRemaining,
    });
    return;
  }

  // Reserve (charge) the credits UP FRONT so every paid provider clip is backed
  // by credits. The worker refunds this automatically if the job permanently
  // fails or is canceled. This replaces the old "deduct only on success" model,
  // which let failed/partial multi-clip jobs incur real provider spend while
  // charging the user nothing.
  // Reservation + job insert run in ONE transaction so a failed insert rolls
  // back the exact bucket debits (no lossy compensating update).
  const jobId = randomUUID();
  const job = await db.transaction(async (tx) => {
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
      requestedDuration: requestedDuration ?? "full",
      clipStartTime: clipStartTime ?? null,
      audioAnalysis: audioAnalysis as unknown as Record<string, unknown> ?? null,
      aiProvider: engine,
      watermark,
      // AI jobs stash billing + clip-salvage state in the (otherwise unused)
      // manifest jsonb: reservedCredits is refunded by the worker on failure.
      manifest: { reservedCredits: creditCost } as unknown as Record<string, unknown>,
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
    return inserted;
  });

  req.log.info(
    { userId: req.user.id, requestedDuration, creditCost, isAdmin },
    "Job queued — credits reserved up front (refunded automatically on failure)",
  );

  res.status(201).json(job);
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

  const jobData: Record<string, unknown> = { ...job[0] };
  const previewClips = resolvePreviewClips(job[0].manifest);
  if (previewClips) jobData.previewClips = previewClips;
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
    const payload = previewClips ? { ...job, previewClips } : job;
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

  if (job.status !== "failed") {
    res.status(400).json({ error: "Only failed jobs can be retried" });
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
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, jobId))
    .returning();

  res.json(updated);
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
  const IN_PROGRESS = ["pending_approval", "queued", "analyzing", "generating", "stitching"];
  if (!IN_PROGRESS.includes(job.status)) {
    res.status(400).json({ error: "This job isn't running." });
    return;
  }
  await db
    .update(jobsTable)
    .set({ status: "failed", errorMessage: "Canceled by you" })
    .where(eq(jobsTable.id, jobId));
  // Refund the up-front reservation for the canceled job.
  const refunded = await refundJobReservation(job);
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
});

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
  const { clipIndexes, style, promptOverride } = parsed.data;

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

  const remixCost = calculateRemixCost(job.requestedDuration, clips.length, validIndexes.length, job.resolution);
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
      lyricsText: job.lyricsText,
      aspectRatio: job.aspectRatio,
      resolution: job.resolution,
      requestedDuration: job.requestedDuration,
      prompt: promptOverride?.trim() || job.prompt,
      style: (style ?? job.style) as typeof job.style,
      manifest: {
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
