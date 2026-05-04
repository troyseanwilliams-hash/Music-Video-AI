import { Router } from "express";
import { Client } from "pg";
import { db } from "@workspace/db";
import { jobsTable, creditsTable, usersTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  CreateJobBody,
  ListJobsQueryParams,
  GetJobParams,
} from "@workspace/api-zod";

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

  const { prompt, style, audioSourceType, audioObjectPath, audioSourceUrl, lyricsText, aspectRatio, resolution, character, removeWatermark, referenceImagePath, requestedDuration, clipStartTime } =
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

  if (!isAdmin) {
    const status = userRecord?.subscriptionStatus ?? "none";
    const trialEndsAt = userRecord?.trialEndsAt;

    if (status === "trial") {
      if (!trialEndsAt || new Date() > trialEndsAt) {
        res.status(403).json({
          error: "Your free trial has expired. Upgrade to continue creating videos.",
          code: "TRIAL_EXPIRED",
        });
        return;
      }
    } else if (status !== "active") {
      res.status(403).json({
        error: "A subscription is required to create videos.",
        code: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }
  }

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

  if (userCredits.creditsRemaining <= 0) {
    res.status(402).json({ error: "Insufficient credits" });
    return;
  }

  const jobId = randomUUID();
  const [job] = await db
    .insert(jobsTable)
    .values({
      id: jobId,
      userId: req.user.id,
      status: "queued",
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
      removeWatermark: removeWatermark ?? false,
      referenceImagePath: referenceImagePath ?? null,
      requestedDuration: requestedDuration ?? "full",
      clipStartTime: clipStartTime ?? null,
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

  await db
    .update(creditsTable)
    .set({
      creditsRemaining: userCredits.creditsRemaining - 1,
      creditsUsed: userCredits.creditsUsed + 1,
      totalGenerations: userCredits.totalGenerations + 1,
    })
    .where(eq(creditsTable.userId, req.user.id));

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

  res.json(job[0]);
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

  res.redirect(`/api/storage/objects/videos/${job.videoId}.mp4`);
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

export default router;
