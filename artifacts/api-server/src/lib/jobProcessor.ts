import { db } from "@workspace/db";
import { jobsTable, videosTable, creditsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { calculateCreditCost, getClipPlan } from "./creditCost.js";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { logger } from "./logger.js";
import { ObjectStorageService } from "./objectStorage.js";
import { analyzeAudioBuffer, type AudioAnalysis, type AudioSection } from "./audioAnalysis.js";
import { generateClip, downloadClip, getActiveProvider } from "./videoApis.js";
import { stitchVideoClips, extractVideoThumbnail } from "./videoStitcher.js";
import { stitchEditorTimeline } from "./editorStitcher.js";
import { calculateEditorCost } from "./editorCost.js";

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
): Promise<{ buffer: Buffer; targetDuration: number }[]> {
  const provider = getActiveProvider();
  const requestedDur = (job as JobRow & { requestedDuration?: string | null }).requestedDuration;

  // Use the same clip plan as the credit formula so the number of Runway calls
  // matches exactly what was charged.
  const { numClips: maxClips } = getClipPlan(requestedDur);
  // selectSections picks the best unique sections; cycle through them to fill
  // the required clip count (matches worker's buildGenerationPlan approach).
  const baseSections = await selectSections(analysis.sections, maxClips);
  const sections: AudioSection[] = [];
  for (let i = 0; i < maxClips; i++) {
    sections.push(baseSections[i % baseSections.length]!);
  }

  const clips: { buffer: Buffer; targetDuration: number }[] = [];
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
      ? analysis.durationSeconds
      : parseInt(requestedDur, 10);
  const perClipTargetDuration = Math.max(1, totalOutputDuration / sections.length);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const targetDuration = perClipTargetDuration;
    const clipDuration = Math.min(Math.max(Math.ceil(targetDuration), 5), 10);

    await onProgress(30 + Math.floor((i / sections.length) * 40));

    let clipBuffer: Buffer;

    if (provider === "simulation") {
      logger.info(
        { jobId: job.id, section: section.label, clipDuration },
        "Simulation: creating placeholder clip",
      );
      await new Promise((r) => setTimeout(r, 1500));
      clipBuffer = await createSimulationClip(clipDuration);
    } else {
      const prompt = buildSectionPrompt(job, analysis, section);
      logger.info(
        { jobId: job.id, section: section.label, provider, prompt: prompt.slice(0, 80) },
        "Generating AI clip",
      );
      const result = await generateClip({
        prompt,
        durationSeconds: clipDuration,
        aspectRatio: job.aspectRatio ?? "16:9",
        imageUrl: refImageUrl ?? undefined,
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

    clips.push({ buffer: clipBuffer, targetDuration });
  }

  return clips;
}

async function retryOrFail(job: JobRow, err: unknown): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);
  logger.error({ err, jobId: job.id, retryCount: job.retryCount }, "Job failed");

  // Moderation / content-policy failures will never succeed on retry — fail fast.
  if (/moderation|content policy|safety system/i.test(errMsg)) {
    logger.warn({ jobId: job.id }, "Permanent failure: content moderation rejection, skipping retries");
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage:
        "Your prompt was rejected by the AI provider's content policy. Please edit your prompt and try again.",
    });
    return;
  }

  const nextRetry = (job.retryCount ?? 0) + 1;

  if (nextRetry < MAX_RETRIES) {
    const delayMs = Math.pow(2, nextRetry) * 60_000;
    logger.info({ jobId: job.id, nextRetry, delayMs }, "Scheduling retry");

    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: `${errMsg} — retry ${nextRetry}/${MAX_RETRIES} in ${delayMs / 60_000}m`,
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
      errorMessage: `${errMsg} (max ${MAX_RETRIES} retries reached)`,
    });
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
  watermark?: boolean;
  chargeCredits?: boolean; // true only when trial ended and not subscribed
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

    const segments = [];
    for (const s of manifest.segments) {
      const file = await storageService.getObjectEntityFile(s.objectPath);
      const [buf] = await file.download();
      const ext = extFromObjectPath(s.objectPath, s.kind === "photo" ? "jpg" : "mp4");
      segments.push({ buffer: buf, kind: s.kind, durationSec: s.durationSec, ext });
    }

    let music;
    if (manifest.music?.objectPath) {
      const file = await storageService.getObjectEntityFile(manifest.music.objectPath);
      const [buf] = await file.download();
      const ext = extFromObjectPath(manifest.music.objectPath, "mp3");
      music = { buffer: buf, ext, mode: manifest.music.mode, volume: manifest.music.volume };
    }

    const [width, height] = manifest.resolution === "1080p" ? [1920, 1080] : [1280, 720];
    await updateJobStatus(job.id, { progressPercent: 55 });

    const result = await stitchEditorTimeline({
      segments,
      music,
      transition: manifest.transition,
      width,
      height,
      watermark: manifest.watermark === true,
    });

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
      title: "Studio export",
      durationSeconds: result.durationSeconds,
      shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    });

    // Trial/subscription renders are free; post-trial renders deduct credits.
    if (manifest.chargeCredits) {
      const creditCost = calculateEditorCost({
        durationSec: result.durationSeconds,
        resolution: manifest.resolution,
        hasTransitions: !!manifest.transition && manifest.transition.type !== "none",
      });
      await db
        .update(creditsTable)
        .set({
          creditsRemaining: sql`GREATEST(credits_remaining - ${creditCost}, 0)`,
          creditsUsed: sql`credits_used + ${creditCost}`,
          totalGenerations: sql`total_generations + 1`,
        })
        .where(eq(creditsTable.userId, job.userId));
    }

    await updateJobStatus(job.id, { status: "ready", progressPercent: 100, videoId });
    logger.info({ jobId: job.id, videoId }, "Editor render completed");
  } catch (err) {
    await retryOrFail(job, err);
  }
}

async function processJob(job: JobRow): Promise<void> {
  if (job.jobType === "editor_render") {
    await processEditorJob(job);
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
      shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    });

    const creditCost = calculateCreditCost(job.requestedDuration);
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
const STALE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

async function recoverStaleJobs(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const stale = await db.execute<{ id: string }>(sql`
      UPDATE jobs
      SET
        status    = 'queued',
        claimed_at = NULL,
        progress_percent = 0,
        error_message = 'Auto-recovered: stuck for >15 min without progress',
        retry_count = LEAST(retry_count + 1, ${MAX_RETRIES - 1}),
        updated_at = NOW()
      WHERE status IN ('analyzing', 'generating', 'stitching')
        AND updated_at < ${cutoff}
        AND retry_count < ${MAX_RETRIES}
      RETURNING id
    `);
    const recovered = stale.rows;
    if (recovered.length > 0) {
      logger.warn({ recovered: recovered.map((r) => r.id) }, "Recovered stale jobs");
      for (const { id } of recovered) await notifyJobUpdate(id);
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

  const poll = async () => {
    try {
      const job = await claimNextJob();
      if (job) {
        processJob(job).catch((err) =>
          logger.error({ err, jobId: job.id }, "Unhandled job error"),
        );
      }
    } catch (err) {
      logger.error({ err }, "Poll error");
    }
    setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}
