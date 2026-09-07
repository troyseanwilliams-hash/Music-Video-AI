import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { and, eq } from "drizzle-orm";
import { db, jobsTable, podcastJobsTable } from "@workspace/db";
import { withResourceLease } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage.js";
import { notifyAdminRenderFailed, notifyRenderReady } from "./renderEmail.js";
import { isTransientInfrastructureError, recoverableInfrastructureError } from "./infrastructureRetry.js";
import { buildTimedSrt, ffprobeHasVideoStream, podcastRenderArgs, selectPodcastHighlights } from "./podcastCaptions.js";

const execFileAsync = promisify(execFile);
const storage = new ObjectStorageService();
const AAI = "https://api.assemblyai.com/v2";

type Word = { text: string; start: number; end: number };
type Transcript = { text?: string; words?: Word[]; status?: string };
class UncertainTranscriptionSubmissionError extends Error {
  constructor() {
    super("ASSEMBLYAI submission outcome is uncertain; support must verify it before retrying.");
    this.name = "UncertainTranscriptionSubmissionError";
  }
}
class ConclusiveTranscriptionSubmissionError extends Error {
  constructor(readonly status: number) {
    super(`AssemblyAI temporarily unavailable (${status})`);
    this.name = "ConclusiveTranscriptionSubmissionError";
  }
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function assertClaim(job: typeof jobsTable.$inferSelect): Promise<void> {
  const [owned] = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.id, job.id), eq(jobsTable.claimedAt, job.claimedAt!))).limit(1);
  if (!owned) throw new Error("Podcast job claim was lost");
}
async function updatePodcastOwned(job: typeof jobsTable.$inferSelect, podcastId: string, values: Partial<typeof podcastJobsTable.$inferInsert>): Promise<void> {
  await db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.id, job.id), eq(jobsTable.claimedAt, job.claimedAt!))).limit(1).for("update");
    if (!owned) throw new Error("Podcast job claim was lost");
    const changed = await tx.update(podcastJobsTable).set(values).where(and(eq(podcastJobsTable.id, podcastId), eq(podcastJobsTable.jobId, job.id))).returning({ id: podcastJobsTable.id });
    if (!changed.length) throw new Error("Podcast job claim was lost");
  });
}
async function updateJobOwned(job: typeof jobsTable.$inferSelect, values: Partial<typeof jobsTable.$inferInsert>): Promise<void> {
  const changed = await db.update(jobsTable).set(values).where(and(eq(jobsTable.id, job.id), eq(jobsTable.claimedAt, job.claimedAt!))).returning({ id: jobsTable.id });
  if (!changed.length) throw new Error("Podcast job claim was lost");
}


function customerError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/ASSEMBLYAI|transcript/i.test(message)) return "We couldn't transcribe this media. Please try again later.";
  if (/ffmpeg|media|decode/i.test(message)) return "We couldn't process this media. Please upload a supported audio file or MP4.";
  return "Podcast processing could not be completed. Please try again later.";
}

async function transcribe(signedUrl: string, podcastId: string, existingId: string | null, processingStage: string, job: typeof jobsTable.$inferSelect): Promise<Transcript> {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI is not configured");
  let id = existingId;
  if (!id) {
    if (processingStage === "submission_intent" || processingStage === "submission_uncertain") {
      await updatePodcastOwned(job, podcastId, { processingStage: "submission_uncertain" });
      throw new UncertainTranscriptionSubmissionError();
    }
    const [owner] = await db.select({ id: jobsTable.id }).from(jobsTable).innerJoin(podcastJobsTable, eq(podcastJobsTable.jobId, jobsTable.id)).where(and(eq(podcastJobsTable.id, podcastId), eq(jobsTable.status, "analyzing"))).limit(1);
    if (!owner) throw new Error("Podcast job claim was lost");
    await updatePodcastOwned(job, podcastId, { processingStage: "submission_intent" });
    try {
      id = await withResourceLease("assemblyai_submission", async ({ signal }) => {
        const submitted = await fetch(`${AAI}/transcript`, {
          method: "POST",
          headers: { authorization: key, "content-type": "application/json" },
          body: JSON.stringify({ audio_url: signedUrl, speech_models: ["universal-2"], punctuate: true, format_text: true }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        });
        if (!submitted.ok) {
          if (submitted.status === 429 || submitted.status >= 500) throw new ConclusiveTranscriptionSubmissionError(submitted.status);
          throw new ConclusiveTranscriptionSubmissionError(submitted.status);
        }
        const submittedId = (await submitted.json() as { id?: string }).id;
        if (!submittedId) throw new Error("ASSEMBLYAI accepted submission without a transcript id");
        await updatePodcastOwned(job, podcastId, { providerTranscriptId: submittedId, processingStage: "transcribing" });
        return submittedId;
      }, { jobId: job.id, heartbeat: () => assertClaim(job) });
    } catch (error) {
      if (error instanceof ConclusiveTranscriptionSubmissionError) {
        if (error.status === 429 || error.status >= 500) throw recoverableInfrastructureError(error);
        throw error;
      }
      await updatePodcastOwned(job, podcastId, { processingStage: "submission_uncertain" }).catch(() => {});
      throw new UncertainTranscriptionSubmissionError();
    }
  }
  if (!id) throw new Error("ASSEMBLYAI no transcript id");
  for (let i = 0; i < 120; i++) {
    await wait(3_000);
    const response = await fetch(`${AAI}/transcript/${id}`, { headers: { authorization: key }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) continue;
      throw new Error("ASSEMBLYAI polling failed");
    }
    const result = await response.json() as Transcript & { error?: string };
    if (result.status === "completed") return result;
    if (result.status === "error") throw new Error("ASSEMBLYAI transcription failed");
  }
  throw recoverableInfrastructureError(new Error("ASSEMBLYAI transcription timed out"));
}

/** Durable, idempotent podcast assembly. All externally visible progress is persisted. */
export async function processPodcastJob(job: typeof jobsTable.$inferSelect): Promise<void> {
  const [podcast] = await db.select().from(podcastJobsTable).where(eq(podcastJobsTable.jobId, job.id)).limit(1);
  if (!podcast || !job.audioObjectPath) throw new Error("Podcast source is missing");
  const dir = join(tmpdir(), `podcast-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    await updateJobOwned(job, { status: "analyzing", progressPercent: 10, errorMessage: null });
    const input = join(dir, "input" + (job.audioObjectPath.toLowerCase().endsWith(".mp4") ? ".mp4" : ".audio"));
    await storage.downloadObjectToFile(job.audioObjectPath, input);
    await assertClaim(job);
    const signedUrl = await storage.getObjectEntitySignedUrl(job.audioObjectPath, 60 * 60);
    const result = podcast.transcript && Array.isArray(podcast.transcriptTimings)
      ? { text: podcast.transcript, words: podcast.transcriptTimings as Word[] }
      : await transcribe(signedUrl, podcast.id, podcast.providerTranscriptId, podcast.processingStage, job);
    const srt = join(dir, "captions.srt");
    await writeFile(srt, buildTimedSrt(result.words ?? []));
    const duration = podcast.durationSeconds ?? (Number(job.requestedDuration) || 0);
    const editorial = selectPodcastHighlights(result.words ?? [], duration);
    await assertClaim(job);
    await updatePodcastOwned(job, podcast.id, { transcript: result.text ?? "", transcriptTimings: result.words ?? [], highlights: editorial, processingStage: "rendering" });
    await updateJobOwned(job, { status: "generating", progressPercent: 45 });
    const master = join(dir, "master.mp4");
    await assertClaim(job);
    const { stdout: streamMetadata } = await withResourceLease("ffmpeg_light", ({ signal }) =>
      execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", input], { timeout: 60_000, signal }),
    { jobId: job.id, heartbeat: () => assertClaim(job) });
    const hasVideo = ffprobeHasVideoStream(String(streamMetadata));
    await assertClaim(job);
    // True video streams are preserved; audio-only containers receive a branded waveform visual.
    await withResourceLease("ffmpeg_heavy", ({ signal }) => execFileAsync("ffmpeg", podcastRenderArgs(input, srt, master, hasVideo), { timeout: 45 * 60_000, signal }), { jobId: job.id, heartbeat: () => assertClaim(job), ttlMs: 10 * 60_000 });
    await assertClaim(job);
    const fullVideoPath = await storage.uploadPodcastFile(master, podcast.id, "full.mp4", "video/mp4");
    await assertClaim(job);
    await updatePodcastOwned(job, podcast.id, { fullVideoPath, processingStage: "previewing" });
    const preview = join(dir, "preview.mp4"), thumb = join(dir, "thumbnail.jpg");
    await withResourceLease("ffmpeg_light", ({ signal }) => execFileAsync("ffmpeg", ["-y", "-i", master, "-vf", "scale='min(iw,1280)':-2", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "2200k", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", preview], { timeout: 45 * 60_000, signal }), { jobId: job.id, heartbeat: () => assertClaim(job), ttlMs: 10 * 60_000 });
    await withResourceLease("ffmpeg_light", ({ signal }) => execFileAsync("ffmpeg", ["-y", "-ss", String(Math.max(1, duration * .15)), "-i", master, "-frames:v", "1", "-vf", "scale=1280:720", thumb], { timeout: 60_000, signal }), { jobId: job.id, heartbeat: () => assertClaim(job) });
    await assertClaim(job);
    const [previewPath, thumbnailPath] = await Promise.all([storage.uploadPodcastFile(preview, podcast.id, "preview.mp4", "video/mp4"), storage.uploadPodcastFile(thumb, podcast.id, "thumbnail.jpg", "image/jpeg")]);
    await assertClaim(job);
    await updatePodcastOwned(job, podcast.id, { previewPath, thumbnailPath, processingStage: "clipping" });
    await updateJobOwned(job, { status: "stitching", progressPercent: 78 });
    const clips: string[] = [];
    for (const clip of editorial) {
      const target = join(dir, `clip-${clip.index}.mp4`);
      await assertClaim(job);
      await withResourceLease("ffmpeg_heavy", ({ signal }) => execFileAsync("ffmpeg", ["-y", "-ss", String(clip.startTime), "-i", master, "-t", String(clip.durationSeconds), "-vf", "crop=min(iw\\,ih*9/16):ih,scale=1080:1920", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", target], { timeout: 15 * 60_000, signal }), { jobId: job.id, heartbeat: () => assertClaim(job), ttlMs: 10 * 60_000 });
      clips.push(await storage.uploadPodcastFile(target, podcast.id, `highlight-${clip.index + 1}.mp4`, "video/mp4"));
      await assertClaim(job);
      await updatePodcastOwned(job, podcast.id, { clipPaths: clips });
    }
    await updatePodcastOwned(job, podcast.id, { fullVideoPath, previewPath, thumbnailPath, clipPaths: clips, processingStage: "complete" });
    await updateJobOwned(job, { status: "ready", progressPercent: 100, claimedAt: null, errorMessage: null });
    void notifyRenderReady(job);
  } catch (error) {
    const uncertain = error instanceof UncertainTranscriptionSubmissionError;
    const retry = !uncertain && isTransientInfrastructureError(error) && podcast.retryCount < 3;
    await updatePodcastOwned(job, podcast.id, { retryCount: podcast.retryCount + (retry ? 1 : 0), processingStage: uncertain ? "submission_uncertain" : retry ? "retrying" : "failed" });
    await updateJobOwned(job, { status: retry ? "queued" : "failed", claimedAt: null, errorMessage: uncertain ? "Transcription may have been submitted, but confirmation was interrupted. We stopped safely to avoid duplicate charges; please contact support." : retry ? "A temporary service interruption occurred. Your podcast will resume automatically." : customerError(error) });
    if (!retry) {
      void notifyAdminRenderFailed(
        job,
        error instanceof Error ? error.message : "Podcast processing failed.",
      );
    }
    throw error;
  } finally { await rm(dir, { recursive: true, force: true }); }
}