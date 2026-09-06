import { Router } from "express";
import { randomUUID } from "crypto";
import ffmpeg from "fluent-ffmpeg";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, jobsTable, podcastJobsTable, soundtracksTable, usersTable } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();
const storage = new ObjectStorageService();
const MAX_PODCAST_SECONDS = 3 * 60 * 60;
const MAX_PODCAST_BYTES = 250 * 1024 * 1024;
function isAdmin(email: string | null | undefined): boolean {
  return !!(process.env.ADMIN_EMAIL && email && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
}

function probeDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (error, metadata) => {
      const duration = metadata.format?.duration;
      if (error || !Number.isFinite(duration) || duration! <= 0) reject(error ?? new Error("invalid duration"));
      else resolve(duration!);
    });
  });
}

function publicPodcast(job: typeof podcastJobsTable.$inferSelect, status: string, progress: number | null, error: string | null) {
  const ready = status === "ready";
  const clipPaths = ready && Array.isArray(job.clipPaths) ? job.clipPaths.filter((path): path is string => typeof path === "string") : [];
  const highlights = Array.isArray(job.highlights)
    ? job.highlights.map((highlight, index) => (
      highlight && typeof highlight === "object"
        ? { ...(highlight as Record<string, unknown>), clipPath: ready ? clipPaths[index] ?? null : null }
        : highlight
    ))
    : [];
  return {
    id: job.id, title: job.title, status, progress: progress ?? 0,
    error: error ?? null, durationSeconds: job.durationSeconds ?? null,
    transcript: job.transcript ?? null, highlights,
    fullVideoPath: ready ? job.fullVideoPath ?? null : null, previewPath: ready ? job.previewPath ?? null : null,
    thumbnailPath: ready ? job.thumbnailPath ?? null : null, clipPaths,
    createdAt: job.createdAt,
  };
}

router.post("/podcast/jobs", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const [user] = await db.select({ subscriptionStatus: usersTable.subscriptionStatus }).from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  if (!isAdmin(req.user.email) && !["active", "trialing"].includes(user?.subscriptionStatus ?? "")) {
    return void res.status(403).json({ error: "An active AIBeatSync subscription is required for Podcast Media." });
  }
  const [active] = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(
    eq(jobsTable.userId, req.user.id), eq(jobsTable.jobType, "podcast"),
    inArray(jobsTable.status, ["queued", "analyzing", "generating", "stitching"]),
  )).limit(1);
  if (active) return void res.status(409).json({ error: "You already have a podcast job in progress." });
  const body = req.body as Record<string, unknown>;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const audioObjectPath = typeof body?.audioObjectPath === "string" ? body.audioObjectPath.trim() : "";
  if (!title || title.length > 200 || !audioObjectPath) {
    return void res.status(400).json({ error: "title and audioObjectPath are required." });
  }
  if (!/\.(?:mp3|wav|m4a|aac|ogg|flac|mp4)$/i.test(audioObjectPath)) {
    return void res.status(422).json({ error: "Upload an audio file or MP4 video." });
  }
  const directOwnerPrefix = [`/objects/uploads/${req.user.id}/`, `/objects/audio/${req.user.id}/`];
  let owned = directOwnerPrefix.some((prefix) => audioObjectPath.startsWith(prefix));
  if (!owned) {
    const [track] = await db.select({ id: soundtracksTable.id }).from(soundtracksTable).where(and(
      eq(soundtracksTable.userId, req.user.id), eq(soundtracksTable.objectPath, audioObjectPath), isNull(soundtracksTable.deletedAt),
    )).limit(1);
    owned = !!track;
  }
  if (!owned) return void res.status(404).json({ error: "Audio file not found." });

  let file;
  try { file = await storage.getObjectEntityFile(audioObjectPath); }
  catch (error) {
    if (error instanceof ObjectNotFoundError) return void res.status(404).json({ error: "Audio file not found." });
    throw error;
  }
  let duration: number;
  try {
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size ?? 0) > MAX_PODCAST_BYTES) {
      return void res.status(413).json({ error: "Podcast media must be 250 MB or smaller." });
    }
    const temp = `/tmp/podcast-check-${randomUUID()}-${audioObjectPath.split("/").pop()}`;
    await storage.downloadObjectToFile(audioObjectPath, temp);
    try { duration = await probeDuration(temp); } finally { await (await import("fs/promises")).unlink(temp).catch(() => {}); }
  } catch {
    return void res.status(422).json({ error: "The uploaded media could not be decoded." });
  }
  if (duration! > MAX_PODCAST_SECONDS) return void res.status(422).json({ error: "Podcast media must be no longer than 3 hours." });
  if (duration! < 90) return void res.status(422).json({ error: "Podcast media must be at least 90 seconds to create three meaningful highlights." });

  const id = randomUUID();
  await db.transaction(async (tx) => {
    // Serializes create/check/insert per owner across every API process.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${req.user.id}, 0))`);
    const [activeInsideLock] = await tx.select({ id: jobsTable.id }).from(jobsTable).where(and(
      eq(jobsTable.userId, req.user.id), eq(jobsTable.jobType, "podcast"),
      inArray(jobsTable.status, ["queued", "analyzing", "generating", "stitching"]),
    )).limit(1);
    if (activeInsideLock) throw new Error("ACTIVE_PODCAST_JOB");
    await tx.insert(jobsTable).values({
      id, userId: req.user.id, jobType: "podcast", status: "queued", audioObjectPath,
      prompt: title, requestedDuration: String(duration),
    });
    await tx.insert(podcastJobsTable).values({ id, jobId: id, userId: req.user.id, title, durationSeconds: duration });
  }).catch((error) => {
    if (error instanceof Error && error.message === "ACTIVE_PODCAST_JOB") return;
    throw error;
  });
  const [inserted] = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.id, id)).limit(1);
  if (!inserted) return void res.status(409).json({ error: "You already have a podcast job in progress." });
  res.status(202).json({ jobId: id });
});

router.get("/podcast/jobs/:id", async (req, res) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const [row] = await db.select({ podcast: podcastJobsTable, status: jobsTable.status, progress: jobsTable.progressPercent, error: jobsTable.errorMessage })
    .from(podcastJobsTable).innerJoin(jobsTable, eq(podcastJobsTable.jobId, jobsTable.id))
    .where(and(eq(podcastJobsTable.id, req.params.id), eq(podcastJobsTable.userId, req.user.id))).limit(1);
  if (!row) return void res.status(404).json({ error: "Podcast job not found." });
  res.json(publicPodcast(row.podcast, row.status, row.progress, row.error));
});

export default router;