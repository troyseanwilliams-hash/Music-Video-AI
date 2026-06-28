import { Router } from "express";
import https from "https";
import { Client } from "pg";
import { db } from "@workspace/db";
import { jobsTable, creditsTable, usersTable, videosTable } from "@workspace/db";
import type { VideoClipMeta } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  CreateJobBody,
  ListJobsQueryParams,
  GetJobParams,
} from "@workspace/api-zod";
import { calculateCreditCost, calculateRemixCost } from "../lib/creditCost.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { notifyJobPendingApproval } from "../lib/notifications.js";

const router = Router();

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

  // Require the copyright/ownership attestation (sent with the request).
  if ((req.body as { acceptCopyright?: unknown })?.acceptCopyright !== true) {
    res.status(403).json({
      error: "You must confirm you own or are licensed to use this audio before generating.",
      code: "COPYRIGHT_REQUIRED",
    });
    return;
  }

  const { prompt, style, audioSourceType, audioObjectPath, audioSourceUrl, lyricsText, aspectRatio, resolution, character, referenceImagePath, requestedDuration, clipStartTime, audioAnalysis } =
    parseResult.data;

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

  const creditCost = calculateCreditCost(requestedDuration);

  if (!isAdmin) {
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

    if (userCredits.creditsRemaining < creditCost) {
      res.status(402).json({
        error: `Insufficient credits — this job costs ${creditCost} credits but you only have ${userCredits.creditsRemaining} remaining.`,
        code: "INSUFFICIENT_CREDITS",
        creditsRequired: creditCost,
        creditsRemaining: userCredits.creditsRemaining,
      });
      return;
    }
  }

  const jobId = randomUUID();
  const [job] = await db
    .insert(jobsTable)
    .values({
      id: jobId,
      userId: req.user.id,
      status: "pending_approval",
      audioSourceType: audioSourceType as
        | "upload"
        | "youtube"
        | "suno"
        | undefined,
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

  req.log.info(
    { userId: req.user.id, requestedDuration, creditCost, isAdmin },
    "Job queued — credits will be deducted on success",
  );

  // Fire-and-forget: notify admin of pending approval (never blocks or errors the response)
  notifyJobPendingApproval({
    id: job.id,
    prompt: job.prompt,
    style: job.style,
    requestedDuration: job.requestedDuration,
    userEmail: userRecord?.email ?? null,
  });

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
  if (job[0].videoId && job[0].status === "ready") {
    const storageService = new ObjectStorageService();
    jobData.videoUrl = await storageService.getVideoSignedUrl(job[0].videoId);

    // Surface the per-clip metadata so the remix UI can list individual clips.
    const [video] = await db
      .select({ clips: videosTable.clips, durationSeconds: videosTable.durationSeconds })
      .from(videosTable)
      .where(eq(videosTable.id, job[0].videoId))
      .limit(1);
    if (video?.clips) jobData.clips = video.clips;
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
    res.write(`data: ${JSON.stringify(job)}\n\n`);
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
    .where(and(eq(videosTable.id, job.videoId), eq(videosTable.userId, req.user.id)))
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

  const remixCost = calculateRemixCost(job.requestedDuration, clips.length, validIndexes.length);
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
