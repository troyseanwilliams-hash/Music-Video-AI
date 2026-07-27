import { db } from "@workspace/db";
import { jobsTable, videosTable, creditsTable } from "@workspace/db";
import type { VideoClipMeta } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { calculateCreditCost, getClipPlan } from "./creditCost.js";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { logger } from "./logger.js";
import { notifyRenderReady, notifyRenderFailed } from "./renderEmail.js";
import { ObjectStorageService } from "./objectStorage.js";
import { analyzeAudioBuffer, type AudioAnalysis, type AudioSection } from "./audioAnalysis.js";
import { generateClip, downloadClip, getActiveProvider, PROVIDER_API_FAILURE } from "./videoApis.js";
import { stitchVideoClips, extractVideoThumbnail } from "./videoStitcher.js";
import { stitchEditorTimeline } from "./editorStitcher.js";

const execAsync = promisify(exec);
const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5000;

const storageService = new ObjectStorageService();
type JobRow = typeof jobsTable.$inferSelect;

async function notifyJobUpdate(jobId: string): Promise<void> {
  try {
    const channel = `job_${jobId.replace(/-/g, "_")}`;
    await db.execute(sql`SELECT pg_notify(${channel}, 'update')`);
  } catch (err) {
    logger.warn({ err, jobId }, "pg NOTIFY failed (non-fatal)");
  }
}

async function claimNextJob(): Promise<JobRow | null> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE jobs
    SET status = 'analyzing', claimed_at = NOW(), updated_at = NOW()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued' AND retry_count < ${MAX_RETRIES}
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);

  const claimedId = result.rows[0]?.id;
  if (!claimedId) return null;

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, claimedId))
    .limit(1);

  return job ?? null;
}

// Heartbeat: while a job is actively processing, bump updated_at every 60s so
// the stale-job watchdog never re-queues an in-flight job. Long 4K clips and
// big stitches can legitimately go >15 min between status updates — without
// the heartbeat, recovery re-queued a live job and a second worker re-called
// the provider API, double-charging.
const HEARTBEAT_INTERVAL_MS = 60_000;
// Heavy ffmpeg renders can starve the DB pool, making individual heartbeat
// writes fail with transient auth/TLS timeouts. Retry each beat a few times
// before giving up so a flaky connection doesn't let the job go stale.
const HEARTBEAT_RETRIES = 3;
const HEARTBEAT_RETRY_DELAY_MS = 5_000;
function startJobHeartbeat(jobId: string): () => void {
  let stopped = false;
  const beat = async () => {
    for (let attempt = 1; attempt <= HEARTBEAT_RETRIES; attempt++) {
      try {
        await db.execute(
          sql`UPDATE jobs SET updated_at = NOW() WHERE id = ${jobId} AND status IN ('analyzing', 'generating', 'stitching')`,
        );
        return;
      } catch (err) {
        if (stopped) return;
        if (attempt === HEARTBEAT_RETRIES) {
          logger.warn(
            { err, jobId, attempts: attempt },
            "Job heartbeat failed after retries (non-fatal)",
          );
        } else {
          await new Promise((r) => setTimeout(r, HEARTBEAT_RETRY_DELAY_MS));
        }
      }
    }
  };
  const t = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(t);
  };
}

// Ownership guard: called immediately before each provider API call. Uses
// claimed_at as a fencing token — the value set when THIS worker claimed the
// job. If stale recovery re-queued the job (status queued/failed, claimed_at
// NULL) or another worker re-claimed it (claimed_at changed), abort this run
// instead of issuing a duplicate — and double-charging — provider call.
const OWNERSHIP_LOST = "job no longer owned by this worker";
async function assertJobOwned(job: JobRow): Promise<void> {
  const [row] = await db
    .select({ status: jobsTable.status, claimedAt: jobsTable.claimedAt })
    .from(jobsTable)
    .where(eq(jobsTable.id, job.id))
    .limit(1);
  const s = row?.status;
  if (!s || s === "queued" || s === "failed") {
    throw new Error(`${OWNERSHIP_LOST} (status: ${s ?? "missing"})`);
  }
  const ours = job.claimedAt ? new Date(job.claimedAt).getTime() : null;
  const current = row?.claimedAt ? new Date(row.claimedAt).getTime() : null;
  if (ours !== current) {
    throw new Error(`${OWNERSHIP_LOST} (claim token changed: re-claimed by another worker)`);
  }
}

async function updateJobStatus(
  jobId: string,
  fields: Partial<typeof jobsTable.$inferInsert>,
): Promise<void> {
  await db
    .update(jobsTable)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(jobsTable.id, jobId));
  await notifyJobUpdate(jobId);
}

async function getAudioBuffer(
  job: JobRow,
): Promise<{ buffer: Buffer; ext: string } | null> {
  // Uploaded file path
  if (job.audioObjectPath) {
    try {
      const file = await storageService.getObjectEntityFile(job.audioObjectPath);
      const [buf] = await file.download();
      const audioFilename = job.audioObjectPath.split("/").pop() ?? "";
      const audioDot = audioFilename.lastIndexOf(".");
      const ext = audioDot !== -1 ? audioFilename.slice(audioDot + 1).toLowerCase() : "mp3";
      return { buffer: buf, ext };
    } catch (err) {
      logger.warn({ err, jobId: job.id }, "Could not download audio, using defaults");
      return null;
    }
  }

  // Suno CDN URL (resolved on the client, stored in audioSourceUrl)
  if (job.audioSourceType === "suno" && job.audioSourceUrl) {
    try {
      logger.info({ jobId: job.id }, "Fetching Suno audio from CDN URL");
      const res = await fetch(job.audioSourceUrl, {
        headers: { "User-Agent": "AIBeatSync/1.0" },
      });
      if (!res.ok) throw new Error(`Suno CDN returned ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { buffer: buf, ext: "mp3" };
    } catch (err) {
      logger.warn({ err, jobId: job.id }, "Could not fetch Suno audio");
      return null;
    }
  }

  return null;
}

const STYLE_PROMPTS: Record<string, string> = {
  realistic:
    "photorealistic cinematography, real performers, professional film lighting, shallow depth of field",
  anime: "anime art style, expressive characters, vibrant cel shading, dynamic speed lines",
  cinematic:
    "cinematic 35mm film, anamorphic bokeh, dramatic chiaroscuro lighting, movie-grade color grade",
  abstract: "abstract geometric visuals, fluid particle simulations, fractals, morphing shapes",
  neon: "neon cyberpunk, glowing signs, rain-slicked streets, vivid purples and electric blues",
  vintage: "super-8 film grain, warm analog tones, light leaks, retro 70s aesthetic",
  fantasy: "high fantasy, magical particle effects, ethereal mist, enchanted landscapes",
  documentary:
    "handheld documentary, natural light, authentic street aesthetic, real-world textures",
};

function buildSectionPrompt(
  job: JobRow,
  analysis: AudioAnalysis,
  section: AudioSection,
): string {
  const style = job.style ?? "cinematic";
  const userPrompt = job.prompt ?? "music video";
  const styleDesc = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.cinematic;

  const energyDesc =
    section.energy > 0.75
      ? "intense dynamic action, explosive motion, vivid dramatic visuals"
      : section.energy > 0.5
        ? "flowing vibrant movement, colorful engaging transitions"
        : "calm atmospheric wide shots, subtle elegant motion";

  const paceDesc =
    analysis.bpm > 140
      ? "rapid-cut editing, high-energy fast motion"
      : analysis.bpm > 100
        ? "upbeat fluid transitions, dynamic movement"
        : "slow atmospheric panning, long smooth dissolves";

  const characterDesc =
    job.character && job.character !== "none"
      ? `featuring ${job.character}`
      : "";

  const parts = [
    styleDesc,
    paceDesc,
    `${analysis.mood} mood`,
    energyDesc,
    characterDesc,
    `${section.label} section visual treatment`,
    userPrompt,
    "beat-synced cuts, professional music video production, 4K ultra-wide",
  ].filter(Boolean);

  return parts.join(", ");
}

async function createSimulationClip(durationSec: number): Promise<Buffer> {
  const id = randomUUID();
  const outPath = join(tmpdir(), `bv_sim_${id}.mp4`);
  try {
    await execAsync(
      `ffmpeg -y -f lavfi -i color=c=0x1a0533:size=1280x720:rate=30 ` +
        `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 ` +
        `-t ${Math.min(durationSec, 10)} ` +
        `-c:v libx264 -preset ultrafast -crf 28 ` +
        `-c:a aac -shortest "${outPath}"`,
      { timeout: 30_000 },
    );
    const { readFile } = await import("fs/promises");
    return readFile(outPath);
  } finally {
    await unlink(outPath).catch(() => {});
  }
}

async function selectSections(sections: AudioSection[], maxClips: number): Promise<AudioSection[]> {
  if (sections.length <= maxClips) return sections;
  const sorted = [...sections].sort((a, b) => b.energy - a.energy);
  const selected = new Set<number>();
  selected.add(sections.indexOf(sorted[0]!));
  selected.add(0);
  selected.add(sections.length - 1);
  // Fill remaining slots with next highest-energy sections
  for (const s of sorted) {
    if (selected.size >= maxClips) break;
    selected.add(sections.indexOf(s));
  }
  return Array.from(selected)
    .sort((a, b) => a - b)
    .map((i) => sections[i]!)
    .slice(0, maxClips);
}

async function loadReferenceImageUrl(job: JobRow): Promise<string | null> {
  if (!job.referenceImagePath) return null;
  try {
    return await storageService.getObjectEntitySignedUrl(job.referenceImagePath, 3600);
  } catch (err) {
    logger.warn({ err, jobId: job.id }, "Could not get reference image URL, skipping");
    return null;
  }
}

async function generateClips(
  job: JobRow,
  analysis: AudioAnalysis,
  onProgress: (pct: number) => Promise<void>,
): Promise<{ buffer: Buffer; targetDuration: number; prompt: string }[]> {
  const provider = getActiveProvider((job as JobRow & { aiProvider?: string | null }).aiProvider ?? undefined);
  const requestedDur = (job as JobRow & { requestedDuration?: string | null }).requestedDuration;

  // Use the same clip plan as the credit formula so the number of provider calls
  // matches exactly what was charged.
  const { numClips: maxClips } = getClipPlan(requestedDur, analysis.durationSeconds);
  // selectSections picks the best unique sections; cycle through them to fill
  // the required clip count (matches worker's buildGenerationPlan approach).
  const baseSections = await selectSections(analysis.sections, maxClips);
  const sections: AudioSection[] = [];
  for (let i = 0; i < maxClips; i++) {
    sections.push(baseSections[i % baseSections.length]!);
  }

  const clips: { buffer: Buffer; targetDuration: number; prompt: string }[] = [];
  const refImageUrl = await loadReferenceImageUrl(job);

  logger.info(
    { jobId: job.id, provider, sectionCount: sections.length, maxClips },
    "Generating clips per section",
  );

  // Compute the total output duration from the job's requested duration.
  // Do NOT use section.endTime - section.startTime: when audio clipping fails
  // or MP3 headers report the wrong total length, section timestamps reflect
  // the full audio file and each clip gets looped for the entire song duration.
  const totalOutputDuration =
    !requestedDur || requestedDur === "full"
      ? Math.min(analysis.durationSeconds, 600) // full videos cap at 10 minutes
      : parseInt(requestedDur, 10);
  const perClipTargetDuration = Math.max(1, totalOutputDuration / sections.length);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const targetDuration = perClipTargetDuration;
    const clipDuration = Math.min(Math.max(Math.ceil(targetDuration), 5), 10);

    await onProgress(30 + Math.floor((i / sections.length) * 40));

    // Build the prompt regardless of provider so it can be persisted as clip
    // metadata (and reused as the basis for a future remix of this clip).
    const prompt = buildSectionPrompt(job, analysis, section);
    let clipBuffer: Buffer;

    if (provider === "simulation") {
      logger.info(
        { jobId: job.id, section: section.label, clipDuration },
        "Simulation: creating placeholder clip",
      );
      await new Promise((r) => setTimeout(r, 1500));
      clipBuffer = await createSimulationClip(clipDuration);
    } else {
      logger.info(
        { jobId: job.id, section: section.label, provider, prompt: prompt.slice(0, 80) },
        "Generating AI clip",
      );
      await assertJobOwned(job);
      const result = await generateClip({
        prompt,
        durationSeconds: clipDuration,
        aspectRatio: job.aspectRatio ?? "16:9",
        imageUrl: refImageUrl ?? undefined,
        // Pin the user's chosen engine (so "Kling" actually renders on Kling)
        // and pass resolution so Kling selects the right model tier / output.
        provider,
        resolution: (job as JobRow & { resolution?: string | null }).resolution,
      });
      if (!result) {
        clipBuffer = await createSimulationClip(clipDuration);
      } else {
        clipBuffer = await downloadClip(result.videoUrl);
        logger.info(
          { jobId: job.id, section: section.label, provider: result.provider },
          "AI clip downloaded",
        );
      }
    }

    clips.push({ buffer: clipBuffer, targetDuration, prompt });
  }

  return clips;
}

// Upload each generated clip to object storage and assemble the clip metadata
// array persisted on videos.clips. Timestamps are cumulative across clips.
async function persistClips(
  videoId: string,
  clips: { buffer: Buffer; targetDuration: number; prompt: string }[],
  style: string | null,
): Promise<VideoClipMeta[]> {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const metas: VideoClipMeta[] = [];
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]!;
    let objectPath = "";
    try {
      objectPath = await storageService.uploadClipBuffer(c.buffer, videoId, i);
    } catch (err) {
      // Non-fatal: a missing clip just can't be reused by remix (it'll be
      // regenerated). Never fail the whole job over clip persistence.
      logger.warn({ err, videoId, index: i }, "Failed to persist clip for remix (non-fatal)");
    }
    const start = cursor;
    const end = cursor + c.targetDuration;
    cursor = end;
    metas.push({
      index: i,
      startTime: round2(start),
      endTime: round2(end),
      durationSec: round2(c.targetDuration),
      prompt: c.prompt,
      style,
      objectPath,
    });
  }
  return metas;
}

async function retryOrFail(job: JobRow, err: unknown): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);

  // Ownership was lost (stale recovery re-queued the job or another worker
  // claimed it). Another run owns this job now — do NOT touch its status or
  // schedule a retry, just stop quietly.
  if (errMsg.includes(OWNERSHIP_LOST)) {
    logger.warn({ jobId: job.id }, "Aborted run: job ownership lost, leaving job to its new owner");
    return;
  }

  logger.error({ err, jobId: job.id, retryCount: job.retryCount }, "Job failed");

  // Moderation / content-policy failures will never succeed on retry — fail fast.
  if (/moderation|content policy|safety system/i.test(errMsg)) {
    logger.warn({ jobId: job.id }, "Permanent failure: content moderation rejection, skipping retries");
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage:
        "Your prompt was rejected by the AI provider's content policy. Please edit your prompt and try again.",
    });
    void notifyRenderFailed(job, "The AI provider's content policy rejected the prompt.");
    return;
  }

  // AI provider API failures (Kling/Pixazo) are never retried — charges happen
  // at submission time, so re-queuing only causes additional billing with no
  // guarantee of a different outcome.
  if (errMsg.includes(PROVIDER_API_FAILURE)) {
    const cleanMsg = errMsg.replace(PROVIDER_API_FAILURE, "").trim();
    logger.warn({ jobId: job.id }, "Permanent failure: AI provider error — not retrying to avoid repeated charges");
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: cleanMsg,
    });
    void notifyRenderFailed(job, cleanMsg);
    return;
  }

  // Expensive jobs (4K or long) regenerate every clip on retry, so a 3× retry of
  // a 4K / multi-minute render burns real provider money for no guaranteed gain.
  // Cap those at a single attempt even for transient errors.
  const j = job as JobRow & { resolution?: string | null; requestedDuration?: string | null };
  const durStr = String(j.requestedDuration ?? "full");
  const isExpensive =
    (j.resolution ?? "").toLowerCase() === "4k" ||
    durStr === "full" || durStr === "300" || durStr === "600" || parseInt(durStr, 10) > 120;
  const maxRetries = isExpensive ? 1 : MAX_RETRIES;

  const nextRetry = (job.retryCount ?? 0) + 1;

  if (nextRetry < maxRetries) {
    const delayMs = Math.pow(2, nextRetry) * 60_000;
    logger.info({ jobId: job.id, nextRetry, delayMs, maxRetries }, "Scheduling retry");

    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: `${errMsg} — retry ${nextRetry}/${maxRetries} in ${delayMs / 60_000}m`,
    });

    setTimeout(async () => {
      await db
        .update(jobsTable)
        .set({
          status: "queued",
          progressPercent: 0,
          errorMessage: null,
          retryCount: nextRetry,
          claimedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(jobsTable.id, job.id));
      await notifyJobUpdate(job.id);
    }, delayMs);
  } else {
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: `${errMsg} (max ${maxRetries} ${maxRetries === 1 ? "attempt" : "retries"} reached)`,
    });
    void notifyRenderFailed(job, errMsg);
  }
}

// Extract a real file extension from an object path. Returns `fallback` when the
// path has no extension (e.g. video uploads stored without a suffix) — guards the
// stitcher against building invalid filenames like `raw_0./objects/uploads/uuid`.
function extFromObjectPath(objectPath: string, fallback: string): string {
  const slash = objectPath.lastIndexOf("/");
  const dot = objectPath.lastIndexOf(".");
  if (dot > slash && dot < objectPath.length - 1) {
    return objectPath.slice(dot + 1).toLowerCase();
  }
  return fallback;
}

// Studio (editor) render manifest stored on the job row.
interface EditorManifest {
  segments: { objectPath: string; kind: "video" | "photo"; durationSec: number }[];
  music?: { objectPath: string; mode: "mix" | "replace"; volume: number };
  transition?: { type: string; durationSec: number };
  resolution?: string;
  orientation?: "landscape" | "portrait"; // 16:9 (default) or 9:16 mobile
  watermark?: boolean;
  chargeCredits?: boolean; // true only when the free monthly allotment is used up
  chargeAmount?: number; // flat credits to deduct when chargeCredits is true
  lyricsText?: string | null; // karaoke burn (plain / LRC / enhanced LRC)
}

// User-driven Studio timeline render — bypasses the AI analyze/generate stages.
async function processEditorJob(job: JobRow): Promise<void> {
  logger.info({ jobId: job.id }, "Processing Studio (editor) render");
  try {
    const manifest = job.manifest as unknown as EditorManifest | null;
    if (!manifest || !manifest.segments?.length) {
      throw new Error("Editor render has an empty manifest");
    }

    await updateJobStatus(job.id, { status: "stitching", progressPercent: 20 });

    // Pull each segment's bytes from object storage. A file that can't be
    // downloaded (deleted, corrupt path, storage error) is removed from the
    // timeline instead of failing the whole render — the user is told exactly
    // which files were dropped and the render continues with the good ones.
    const segments = [];
    const segmentNames: string[] = []; // parallel to `segments`, for reporting
    const removedFiles: string[] = []; // user-facing names of dropped files
    const fileLabel = (objectPath: string, position: number) => {
      const base = objectPath.split("/").pop() || objectPath;
      return `file ${position} (${base})`;
    };
    for (let i = 0; i < manifest.segments.length; i++) {
      const s = manifest.segments[i]!;
      try {
        const file = await storageService.getObjectEntityFile(s.objectPath);
        const [buf] = await file.download();
        const ext = extFromObjectPath(s.objectPath, s.kind === "photo" ? "jpg" : "mp4");
        segments.push({ buffer: buf, kind: s.kind, durationSec: s.durationSec, ext });
        segmentNames.push(fileLabel(s.objectPath, i + 1));
      } catch (err) {
        logger.warn(
          { err, jobId: job.id, objectPath: s.objectPath },
          "Segment file unavailable — removing it from the timeline",
        );
        removedFiles.push(fileLabel(s.objectPath, i + 1));
      }
    }
    if (segments.length === 0) {
      throw new Error("None of the timeline files could be read — nothing to render");
    }

    let music;
    if (manifest.music?.objectPath) {
      try {
        const file = await storageService.getObjectEntityFile(manifest.music.objectPath);
        const [buf] = await file.download();
        const ext = extFromObjectPath(manifest.music.objectPath, "mp3");
        music = { buffer: buf, ext, mode: manifest.music.mode, volume: manifest.music.volume };
      } catch (err) {
        logger.warn(
          { err, jobId: job.id },
          "Music file unavailable — rendering without the music track",
        );
        removedFiles.push("music track");
      }
    }

    // Landscape (16:9) dimensions by size; portrait (9:16) swaps W/H for mobile.
    const [landW, landH] =
      manifest.resolution === "1080p" ? [1920, 1080] : [1280, 720];
    const [width, height] =
      manifest.orientation === "portrait" ? [landH, landW] : [landW, landH];
    await updateJobStatus(job.id, { progressPercent: 22 });

    // Drive progress smoothly from 25%→80% as each segment is normalized so the
    // job-status page can compute a files-based remaining-time estimate. Updates
    // are fire-and-forget (best-effort) and only when the integer percent rises.
    let lastEditorPct = 22;
    // If a previous attempt already failed, drop the transition on retry.
    // Transitions are the most fragile part of the render (extra re-encode
    // passes), so falling back to a hard cut maximizes the odds the retry
    // succeeds. The length-based guard in the stitcher still applies too.
    const isRetry = (job.retryCount ?? 0) > 0;
    const effectiveTransition =
      isRetry && manifest.transition && manifest.transition.type !== "none"
        ? undefined
        : manifest.transition;
    if (isRetry && effectiveTransition === undefined && manifest.transition) {
      logger.info(
        { jobId: job.id, retryCount: job.retryCount },
        "Retry after failure — dropping transition, rendering with hard cuts",
      );
    }
    const result = await stitchEditorTimeline({
      segments,
      music,
      transition: effectiveTransition,
      width,
      height,
      watermark: manifest.watermark === true,
      lyricsText: manifest.lyricsText ?? undefined,
      onProgress: (done, total) => {
        const pct = total > 0 ? 25 + Math.round((done / total) * 55) : 25;
        if (pct > lastEditorPct) {
          lastEditorPct = pct;
          void updateJobStatus(job.id, { progressPercent: pct });
        }
      },
    });
    if (result.transitionsDisabled) {
      logger.info(
        { jobId: job.id, segments: segments.length },
        "Transitions disabled for long timeline — used hard-cut concat",
      );
    }
    // Files the stitcher itself had to drop (corrupt/unreadable during
    // processing) — map its indexes back to user-facing file names.
    for (const s of result.skipped) {
      removedFiles.push(segmentNames[s.index] ?? `file ${s.index + 1}`);
    }
    if (removedFiles.length) {
      logger.warn(
        { jobId: job.id, removedFiles },
        "Some files were removed from the render; continuing with the rest",
      );
    }

    await updateJobStatus(job.id, { progressPercent: 88 });

    const videoId = randomUUID();
    const [videoObjectPath, thumbnailObjectPath] = await Promise.all([
      storageService.uploadVideoBuffer(result.videoBuffer, videoId),
      storageService.uploadThumbnailBuffer(result.thumbnailBuffer, videoId),
    ]);

    await db.insert(videosTable).values({
      id: videoId,
      userId: job.userId,
      jobId: job.id,
      videoObjectPath,
      thumbnailObjectPath,
      title: job.prompt?.trim() || "Studio export",
      durationSeconds: result.durationSeconds,
      shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    });

    // Trial/subscription renders are free; post-trial renders deduct credits.
    if (manifest.chargeCredits) {
      const creditCost = manifest.chargeAmount ?? 0;
      // Deduct from the subscription bucket first, then top-up — same split as
      // AI generation — so creditsRemaining stays equal to sub + top-up.
      await db
        .update(creditsTable)
        .set({
          subscriptionCredits: sql`GREATEST(subscription_credits - ${creditCost}, 0)`,
          topupCredits: sql`GREATEST(topup_credits - GREATEST(${creditCost} - subscription_credits, 0), 0)`,
          creditsRemaining: sql`GREATEST(credits_remaining - ${creditCost}, 0)`,
          creditsUsed: sql`credits_used + ${creditCost}`,
          totalGenerations: sql`total_generations + 1`,
          updatedAt: new Date(),
        })
        .where(eq(creditsTable.userId, job.userId));
      logger.info({ jobId: job.id, userId: job.userId, creditCost }, "Editor credits deducted on success");
    }

    // Surface removed files to the user on the finished job (the job page
    // shows this note alongside the completed video).
    const removedNotice = removedFiles.length
      ? `Note: ${removedFiles.length === 1 ? "1 file" : `${removedFiles.length} files`} couldn't be processed and ${removedFiles.length === 1 ? "was" : "were"} removed from your video: ${removedFiles.join(", ")}. The rest of your files rendered normally.`
      : null;
    await updateJobStatus(job.id, {
      status: "ready",
      progressPercent: 100,
      videoId,
      errorMessage: removedNotice,
    });
    void notifyRenderReady(job);
    logger.info({ jobId: job.id, videoId }, "Editor render completed");
  } catch (err) {
    await retryOrFail(job, err);
  }
}

// Remix manifest stored on a jobType="remix" job row. The job row itself
// carries the inherited audio fields (audioObjectPath / audioSourceUrl /
// aspectRatio / requestedDuration) copied from the original job at creation.
interface RemixManifest {
  originalVideoId: string;
  clipIndexes: number[];
  style?: string | null;
  promptOverride?: string | null;
  remixCost: number;
  chargeCredits?: boolean;
}

// Compose the prompt for a regenerated clip. When the user supplies a prompt
// override or a new style, those take priority; otherwise we fall back to the
// clip's original prompt so an un-overridden remix simply re-rolls the clip.
function composeRemixPrompt(
  clip: VideoClipMeta,
  manifest: RemixManifest,
  jobPrompt: string | null,
): string {
  const styleKey = manifest.style ?? clip.style ?? "cinematic";
  const styleDesc = STYLE_PROMPTS[styleKey] ?? STYLE_PROMPTS.cinematic;
  const override = manifest.promptOverride?.trim();
  // If neither style nor prompt changed, reuse the exact original prompt.
  if (!override && (manifest.style == null || manifest.style === clip.style)) {
    return clip.prompt;
  }
  const userPart = override || jobPrompt || clip.prompt;
  return [styleDesc, userPart, "beat-synced cuts, professional music video production, 4K ultra-wide"]
    .filter(Boolean)
    .join(", ");
}

// Lightweight remix: regenerate only the selected clips of an existing video,
// reuse the rest, and re-stitch with the original audio into a NEW video. The
// original video is never modified, so it stays accessible during the remix.
async function processRemixJob(job: JobRow): Promise<void> {
  logger.info({ jobId: job.id }, "Processing remix job");
  try {
    const manifest = job.manifest as unknown as RemixManifest | null;
    if (!manifest?.originalVideoId || !manifest.clipIndexes?.length) {
      throw new Error("Remix job has an invalid manifest");
    }

    const [original] = await db
      .select()
      .from(videosTable)
      .where(and(eq(videosTable.id, manifest.originalVideoId), eq(videosTable.userId, job.userId)))
      .limit(1);
    if (!original) throw new Error("Original video not found for remix");

    const sourceClips = (original.clips as unknown as VideoClipMeta[] | null) ?? [];
    if (!sourceClips.length) {
      throw new Error("This video has no remixable clips (it was generated before remix was available)");
    }

    await updateJobStatus(job.id, { status: "generating", progressPercent: 10 });

    const regen = new Set(manifest.clipIndexes);
    const ordered = [...sourceClips].sort((a, b) => a.index - b.index);
    const provider = getActiveProvider();

    const built: { buffer: Buffer; targetDuration: number; prompt: string; style: string | null }[] = [];
    let processed = 0;
    for (const clip of ordered) {
      const duration = Math.min(Math.max(Math.ceil(clip.durationSec || 5), 5), 10);

      if (regen.has(clip.index)) {
        const prompt = composeRemixPrompt(clip, manifest, job.prompt);
        const styleKey = manifest.style ?? clip.style ?? null;
        logger.info({ jobId: job.id, index: clip.index, provider }, "Regenerating remix clip");
        let buffer: Buffer;
        if (provider === "simulation") {
          await new Promise((r) => setTimeout(r, 1200));
          buffer = await createSimulationClip(duration);
        } else {
          await assertJobOwned(job);
          const result = await generateClip({
            prompt,
            durationSeconds: duration,
            aspectRatio: job.aspectRatio ?? "16:9",
            provider: (job as JobRow & { aiProvider?: string | null }).aiProvider ?? undefined,
            resolution: (job as JobRow & { resolution?: string | null }).resolution,
          });
          buffer = result ? await downloadClip(result.videoUrl) : await createSimulationClip(duration);
        }
        built.push({ buffer, targetDuration: clip.durationSec, prompt, style: styleKey });
        processed++;
        await updateJobStatus(job.id, {
          progressPercent: 10 + Math.floor((processed / regen.size) * 60),
        });
      } else {
        // Reuse the existing clip bytes untouched.
        let buffer: Buffer;
        try {
          const file = await storageService.getObjectEntityFile(clip.objectPath);
          [buffer] = await file.download();
        } catch (err) {
          logger.warn({ err, jobId: job.id, index: clip.index }, "Could not reuse clip; substituting placeholder");
          buffer = await createSimulationClip(duration);
        }
        built.push({ buffer, targetDuration: clip.durationSec, prompt: clip.prompt, style: clip.style });
      }
    }

    await updateJobStatus(job.id, { status: "stitching", progressPercent: 75 });

    const audioData = await getAudioBuffer(job);
    const totalDuration =
      original.durationSeconds || built.reduce((s, c) => s + (c.targetDuration || 0), 0);

    let videoBuffer: Buffer;
    let thumbnailBuffer: Buffer;
    if (audioData) {
      const stitchResult = await stitchVideoClips({
        clips: built.map((c) => ({ buffer: c.buffer, targetDuration: c.targetDuration })),
        audioBuffer: audioData.buffer,
        audioExt: audioData.ext,
        totalDuration,
        lyricsText: (job as JobRow & { lyricsText?: string | null }).lyricsText ?? undefined,
      });
      videoBuffer = stitchResult.videoBuffer;
      thumbnailBuffer = stitchResult.thumbnailBuffer;
    } else {
      videoBuffer = built[0]?.buffer ?? (await createSimulationClip(10));
      thumbnailBuffer = await extractVideoThumbnail(videoBuffer, 2);
    }

    await updateJobStatus(job.id, { progressPercent: 90 });

    const newVideoId = randomUUID();
    const [videoObjectPath, thumbnailObjectPath] = await Promise.all([
      storageService.uploadVideoBuffer(videoBuffer, newVideoId),
      storageService.uploadThumbnailBuffer(thumbnailBuffer, newVideoId),
    ]);

    // Persist the remixed clip set (new bytes for regenerated clips, copies for
    // reused ones) so the result can itself be remixed again.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const newClips: VideoClipMeta[] = [];
    let cursor = 0;
    for (let i = 0; i < built.length; i++) {
      const c = built[i]!;
      let objectPath = "";
      try {
        objectPath = await storageService.uploadClipBuffer(c.buffer, newVideoId, i);
      } catch (err) {
        logger.warn({ err, newVideoId, index: i }, "Failed to persist remix clip (non-fatal)");
      }
      const start = cursor;
      const end = cursor + c.targetDuration;
      cursor = end;
      newClips.push({
        index: i,
        startTime: round2(start),
        endTime: round2(end),
        durationSec: round2(c.targetDuration),
        prompt: c.prompt,
        style: c.style,
        objectPath,
      });
    }

    await db.insert(videosTable).values({
      id: newVideoId,
      userId: job.userId,
      jobId: job.id,
      videoObjectPath,
      thumbnailObjectPath,
      title: original.title ? `Remix — ${original.title}`.slice(0, 100) : "Remix",
      durationSeconds: totalDuration,
      style: (manifest.style ?? original.style) as typeof original.style,
      prompt: manifest.promptOverride?.trim() || original.prompt,
      clips: newClips as unknown as Record<string, unknown>,
      shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    });

    if (manifest.chargeCredits && manifest.remixCost > 0) {
      const cost = manifest.remixCost;
      await db
        .update(creditsTable)
        .set({
          subscriptionCredits: sql`GREATEST(subscription_credits - ${cost}, 0)`,
          topupCredits: sql`GREATEST(topup_credits - GREATEST(${cost} - subscription_credits, 0), 0)`,
          creditsRemaining: sql`GREATEST(credits_remaining - ${cost}, 0)`,
          creditsUsed: sql`credits_used + ${cost}`,
          totalGenerations: sql`total_generations + 1`,
          updatedAt: new Date(),
        })
        .where(eq(creditsTable.userId, job.userId));
      logger.info({ jobId: job.id, cost }, "Remix credits deducted on success");
    }

    await updateJobStatus(job.id, { status: "ready", progressPercent: 100, videoId: newVideoId });
    void notifyRenderReady(job);
    logger.info({ jobId: job.id, newVideoId }, "Remix completed");
  } catch (err) {
    await retryOrFail(job, err);
  }
}

async function processJob(job: JobRow): Promise<void> {
  if (job.jobType === "editor_render") {
    await processEditorJob(job);
    return;
  }
  if (job.jobType === "remix") {
    await processRemixJob(job);
    return;
  }

  logger.info({ jobId: job.id, style: job.style, provider: getActiveProvider() }, "Processing job");

  try {
    // === ANALYZING ===
    await updateJobStatus(job.id, { progressPercent: 5 });

    const audioData = await getAudioBuffer(job);
    let analysis: AudioAnalysis;

    const preComputed = job.audioAnalysis as unknown as AudioAnalysis | null;
    if (preComputed?.bpm && preComputed?.sections?.length) {
      logger.info(
        { jobId: job.id, bpm: preComputed.bpm, mood: preComputed.mood },
        "Using pre-computed audio analysis from job creation — skipping ffmpeg analysis",
      );
      analysis = preComputed;
    } else if (audioData) {
      logger.info({ jobId: job.id }, "Running ffmpeg PCM beat analysis");
      analysis = await analyzeAudioBuffer(audioData.buffer, audioData.ext);
      logger.info(
        { jobId: job.id, bpm: analysis.bpm, mood: analysis.mood, sections: analysis.sections.length },
        "Audio analysis complete",
      );
    } else {
      logger.warn({ jobId: job.id }, "No audio file, using synthetic analysis");
      const bpm = 120 + Math.floor(Math.random() * 40);
      const dur = 180;
      analysis = {
        bpm,
        key: "C major",
        energy: 0.65,
        mood: "energetic",
        durationSeconds: dur,
        beatTimestamps: Array.from({ length: Math.min(500, Math.floor(dur / (60 / bpm))) }, (_, i) =>
          Math.round(i * (60 / bpm) * 100) / 100,
        ),
        sections: [
          { startTime: 0, endTime: 45, label: "intro", energy: 0.3 },
          { startTime: 45, endTime: 90, label: "verse", energy: 0.55 },
          { startTime: 90, endTime: 135, label: "chorus", energy: 0.9 },
          { startTime: 135, endTime: 180, label: "outro", energy: 0.4 },
        ],
        beatGrid: Array.from({ length: 45 }, (_, i) => Math.round(i * (60 / bpm) * 4 * 100) / 100),
      };
    }

    await updateJobStatus(job.id, {
      status: "generating",
      audioAnalysis: analysis as unknown as Record<string, unknown>,
      progressPercent: 25,
    });

    // === GENERATING ===
    const clips = await generateClips(job, analysis, (pct) =>
      updateJobStatus(job.id, { progressPercent: pct }),
    );

    await updateJobStatus(job.id, { status: "stitching", progressPercent: 75 });

    // === STITCHING ===
    logger.info({ jobId: job.id, clipCount: clips.length }, "Stitching clips with audio");

    const lyricsText = (job as JobRow & { lyricsText?: string | null }).lyricsText ?? undefined;

    let videoBuffer: Buffer;
    let thumbnailBuffer: Buffer;

    if (audioData) {
      const reqDur = (job as JobRow & { requestedDuration?: string | null }).requestedDuration;
      const stitchDuration =
        !reqDur || reqDur === "full"
          ? analysis.durationSeconds
          : parseInt(reqDur, 10);
      const stitchResult = await stitchVideoClips({
        clips,
        audioBuffer: audioData.buffer,
        audioExt: audioData.ext,
        totalDuration: stitchDuration,
        lyricsText,
      });
      videoBuffer = stitchResult.videoBuffer;
      thumbnailBuffer = stitchResult.thumbnailBuffer;
    } else {
      const firstClip = clips[0];
      if (firstClip) {
        videoBuffer = firstClip.buffer;
        thumbnailBuffer = await extractVideoThumbnail(videoBuffer, 2);
      } else {
        videoBuffer = await createSimulationClip(10);
        thumbnailBuffer = await extractVideoThumbnail(videoBuffer, 2);
      }
    }

    await updateJobStatus(job.id, { progressPercent: 88 });

    // === STORING ===
    const videoId = randomUUID();
    logger.info({ jobId: job.id, videoId }, "Uploading video and thumbnail");

    const [videoObjectPath, thumbnailObjectPath] = await Promise.all([
      storageService.uploadVideoBuffer(videoBuffer, videoId),
      storageService.uploadThumbnailBuffer(thumbnailBuffer, videoId),
    ]);

    // Persist individual clips so the user can remix (regenerate) any one of
    // them later without rerunning the whole pipeline.
    const clipMetas = await persistClips(videoId, clips, job.style ?? null);

    await db.insert(videosTable).values({
      id: videoId,
      userId: job.userId,
      jobId: job.id,
      videoObjectPath,
      thumbnailObjectPath,
      title: job.prompt ? job.prompt.slice(0, 100) : "Generated Video",
      durationSeconds: analysis.durationSeconds,
      style: job.style,
      prompt: job.prompt,
      clips: clipMetas as unknown as Record<string, unknown>,
      shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    });

    const creditCost = calculateCreditCost(job.requestedDuration, job.resolution, analysis.durationSeconds, (job as JobRow & { aiProvider?: string | null }).aiProvider ?? undefined);
    // Deduct from the subscription bucket first, then top-up. This way one-time
    // top-ups survive any future "reset monthly credits at renewal" behavior.
    await db
      .update(creditsTable)
      .set({
        subscriptionCredits: sql`GREATEST(subscription_credits - ${creditCost}, 0)`,
        topupCredits: sql`GREATEST(topup_credits - GREATEST(${creditCost} - subscription_credits, 0), 0)`,
        creditsRemaining: sql`GREATEST(credits_remaining - ${creditCost}, 0)`,
        creditsUsed: sql`credits_used + ${creditCost}`,
        totalGenerations: sql`total_generations + 1`,
        updatedAt: new Date(),
      })
      .where(eq(creditsTable.userId, job.userId));
    logger.info({ jobId: job.id, userId: job.userId, creditCost }, "Credits deducted on success");

    await updateJobStatus(job.id, { status: "ready", progressPercent: 100, videoId });
    void notifyRenderReady(job);
    logger.info({ jobId: job.id, videoId, provider: getActiveProvider() }, "Job completed");
  } catch (err) {
    await retryOrFail(job, err);
  }
}

// Reset jobs that have been stuck in a non-terminal, non-queued state for
// longer than STALE_THRESHOLD_MS. This recovers from: Runway API hangs that
// exceed the 10-minute polling timeout, unhandled crashes mid-generation, and
// any other scenario where the process dies without marking the job failed.
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
// Editor renders run long ffmpeg pipelines that can legitimately go far
// longer between status updates (and can starve heartbeat writes), so they
// get a much more generous stale threshold.
const EDITOR_STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes
const STALE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

// Jobs actively being processed by THIS process. The local watchdog must
// never re-queue a job it is itself running — heartbeat failures caused by
// transient DB issues would otherwise kill a live render.
const inFlightJobIds = new Set<string>();

async function recoverStaleJobs(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const editorCutoff = new Date(Date.now() - EDITOR_STALE_THRESHOLD_MS);
    const inFlight = [...inFlightJobIds];
    const notInFlight = inFlight.length
      ? sql`AND id NOT IN (${sql.join(
          inFlight.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
    const staleWindow = sql`(
        (job_type <> 'editor_render' AND updated_at < ${cutoff})
        OR (job_type = 'editor_render' AND updated_at < ${editorCutoff})
      )`;
    // Re-queue stale jobs that still have retries left. The counter must
    // actually increment past the cap — the old LEAST(retry_count + 1, MAX - 1)
    // clamp kept retry_count below MAX_RETRIES forever, so a chronically stuck
    // job was re-queued (and re-billed at the AI provider) in an endless loop.
    const stale = await db.execute<{ id: string }>(sql`
      UPDATE jobs
      SET
        status    = 'queued',
        claimed_at = NULL,
        progress_percent = 0,
        error_message = 'Auto-recovered: stuck for >15 min without progress',
        retry_count = retry_count + 1,
        updated_at = NOW()
      WHERE status IN ('analyzing', 'generating', 'stitching')
        AND ${staleWindow}
        AND retry_count < ${MAX_RETRIES - 1}
        ${notInFlight}
      RETURNING id
    `);
    const recovered = stale.rows;
    if (recovered.length > 0) {
      logger.warn({ recovered: recovered.map((r) => r.id) }, "Recovered stale jobs");
      for (const { id } of recovered) await notifyJobUpdate(id);
    }

    // Stale jobs that have exhausted retries are failed permanently instead of
    // being re-queued — this is the hard stop that prevents endless provider
    // charges for a job that can never finish.
    const exhausted = await db.execute<{ id: string }>(sql`
      UPDATE jobs
      SET
        status    = 'failed',
        claimed_at = NULL,
        error_message = 'Failed: stuck repeatedly without progress (max retries reached)',
        updated_at = NOW()
      WHERE status IN ('analyzing', 'generating', 'stitching')
        AND ${staleWindow}
        AND retry_count >= ${MAX_RETRIES - 1}
        ${notInFlight}
      RETURNING id
    `);
    if (exhausted.rows.length > 0) {
      logger.error(
        { failed: exhausted.rows.map((r) => r.id) },
        "Stale jobs permanently failed after exhausting retries",
      );
      for (const { id } of exhausted.rows) await notifyJobUpdate(id);
    }
  } catch (err) {
    logger.error({ err }, "Stale job recovery error (non-fatal)");
  }
}

let isRunning = false;

export async function startJobProcessor(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  logger.info("Job processor started");

  // Run stale-job recovery immediately on startup (catches jobs stuck across
  // a deployment restart), then on a regular interval.
  recoverStaleJobs();
  setInterval(recoverStaleJobs, STALE_CHECK_INTERVAL_MS);

  // Only one job at a time per process: renders run heavy ffmpeg pipelines,
  // and two concurrent renders can exhaust memory and crash the whole server
  // (which re-queues both jobs and repeats the crash loop). Claiming is
  // skipped while a job is in flight; other workers still pick up queued jobs
  // via FOR UPDATE SKIP LOCKED.
  let busy = false;
  const poll = async () => {
    if (!busy) {
      try {
        const job = await claimNextJob();
        if (job) {
          busy = true;
          inFlightJobIds.add(job.id);
          const stopHeartbeat = startJobHeartbeat(job.id);
          processJob(job)
            .catch((err) =>
              logger.error({ err, jobId: job.id }, "Unhandled job error"),
            )
            .finally(() => {
              stopHeartbeat();
              inFlightJobIds.delete(job.id);
              busy = false;
            });
        }
      } catch (err) {
        logger.error({ err }, "Poll error");
      }
    }
    setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}
