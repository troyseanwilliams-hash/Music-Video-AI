import { db } from "@workspace/db";
import { jobsTable, videosTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";
import { analyzeAudioBuffer, type AudioAnalysis, type AudioSection } from "./audioAnalysis";
import { generateClip, downloadClip, getActiveProvider } from "./videoApis";
import { stitchVideoClips, extractVideoThumbnail } from "./videoStitcher";

const execAsync = promisify(exec);
const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5000;
const MAX_CLIPS_PER_JOB = 3;

async function extractAudioClip(
  audio: { buffer: Buffer; ext: string },
  startSec: number,
  durationSec: number,
): Promise<{ buffer: Buffer; ext: string }> {
  const id = randomUUID();
  const inputPath = join(tmpdir(), `bv_in_${id}.${audio.ext}`);
  const outputPath = join(tmpdir(), `bv_clip_${id}.${audio.ext}`);
  try {
    await writeFile(inputPath, audio.buffer);
    await execAsync(
      `ffmpeg -y -ss ${startSec.toFixed(3)} -t ${durationSec} -i "${inputPath}" -c copy "${outputPath}"`,
      { timeout: 30_000 },
    );
    const { readFile } = await import("fs/promises");
    const clipped = await readFile(outputPath);
    return { buffer: clipped, ext: audio.ext };
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

interface GenerationPlan {
  sections: AudioSection[];
  clipDurationSec: 5 | 10;
  targetOutputDuration: number;
}

function buildGenerationPlan(
  requestedDuration: string | null | undefined,
  sections: AudioSection[],
  audioDurationSec: number,
): GenerationPlan {
  const dur = requestedDuration ?? "full";

  if (dur === "full") {
    const selected = sections.length <= MAX_CLIPS_PER_JOB
      ? sections
      : (() => {
          const sorted = [...sections].sort((a, b) => b.energy - a.energy);
          const picked = new Set<number>();
          picked.add(sections.indexOf(sorted[0]!));
          picked.add(0);
          picked.add(sections.length - 1);
          return Array.from(picked).sort((a, b) => a - b).map((i) => sections[i]!).slice(0, MAX_CLIPS_PER_JOB);
        })();
    return { sections: selected, clipDurationSec: 10, targetOutputDuration: audioDurationSec };
  }

  const durSec = parseInt(dur, 10); // 5, 8, 10, 30, 60
  const clipDurationSec: 5 | 10 = durSec <= 5 ? 5 : 10;
  const numClips = Math.max(1, Math.ceil(durSec / clipDurationSec));

  // Select sections, cycling if we need more clips than sections
  const sorted = [...sections].sort((a, b) => b.energy - a.energy);
  const selected: AudioSection[] = [];
  for (let i = 0; i < numClips; i++) {
    selected.push(sorted[i % sorted.length]!);
  }

  return { sections: selected, clipDurationSec, targetOutputDuration: durSec };
}

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
  const result = await db.execute(sql`
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

  const rows = (result as { rows: { id: string }[] }).rows;
  const claimedId = rows[0]?.id;
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
  if (!job.audioObjectPath) return null;
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


async function loadReferenceImageDataUrl(job: JobRow): Promise<string | null> {
  if (!job.referenceImagePath) return null;
  try {
    const file = await storageService.getObjectEntityFile(job.referenceImagePath);
    const [buf] = await file.download();
    const imgFilename = job.referenceImagePath.split("/").pop() ?? "";
    const imgDot = imgFilename.lastIndexOf(".");
    const ext = imgDot !== -1 ? imgFilename.slice(imgDot + 1).toLowerCase() : "jpg";
    const mime =
      ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch (err) {
    logger.warn({ err, jobId: job.id }, "Could not load reference image, skipping");
    return null;
  }
}

async function generateClips(
  job: JobRow,
  analysis: AudioAnalysis,
  plan: GenerationPlan,
  onProgress: (pct: number) => Promise<void>,
): Promise<{ buffer: Buffer; targetDuration: number }[]> {
  const provider = getActiveProvider();
  const { sections, clipDurationSec } = plan;
  const clips: { buffer: Buffer; targetDuration: number }[] = [];
  const refImageDataUrl = await loadReferenceImageDataUrl(job);

  logger.info(
    { jobId: job.id, provider, sectionCount: sections.length, clipDurationSec, targetOutputDuration: plan.targetOutputDuration },
    "Generating clips per plan",
  );

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const targetDuration = Math.max(1, section.endTime - section.startTime);
    const clipDuration = clipDurationSec;

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
        removeWatermark: job.removeWatermark ?? false,
        imageDataUrl: refImageDataUrl ?? undefined,
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

type ExtendedJobRow = JobRow & {
  requestedDuration?: string | null;
  clipStartTime?: number | null;
};

async function processJob(job: JobRow): Promise<void> {
  logger.info({ jobId: job.id, style: job.style, provider: getActiveProvider() }, "Processing job");

  const extJob = job as ExtendedJobRow;

  try {
    // === ANALYZING ===
    await updateJobStatus(job.id, { progressPercent: 5 });

    const rawAudioData = await getAudioBuffer(job);

    // If the user selected a specific clip window, extract just that segment
    let audioData = rawAudioData;
    if (
      rawAudioData &&
      extJob.clipStartTime != null &&
      extJob.clipStartTime >= 0 &&
      extJob.requestedDuration &&
      extJob.requestedDuration !== "full"
    ) {
      const durSec = parseInt(extJob.requestedDuration, 10);
      logger.info(
        { jobId: job.id, clipStartTime: extJob.clipStartTime, durSec },
        "Extracting audio clip segment",
      );
      audioData = await extractAudioClip(rawAudioData, extJob.clipStartTime, durSec);
    }

    let analysis: AudioAnalysis;

    if (audioData) {
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
    const plan = buildGenerationPlan(
      extJob.requestedDuration,
      analysis.sections,
      analysis.durationSeconds,
    );

    logger.info(
      { jobId: job.id, requestedDuration: extJob.requestedDuration, planClips: plan.sections.length, targetOutputDuration: plan.targetOutputDuration },
      "Generation plan built",
    );

    const clips = await generateClips(job, analysis, plan, (pct) =>
      updateJobStatus(job.id, { progressPercent: pct }),
    );

    await updateJobStatus(job.id, { status: "stitching", progressPercent: 75 });

    // === STITCHING ===
    logger.info({ jobId: job.id, clipCount: clips.length }, "Stitching clips with audio");

    const lyricsText = extJob.lyricsText ?? undefined;

    let videoBuffer: Buffer;
    let thumbnailBuffer: Buffer;

    if (audioData) {
      const stitchResult = await stitchVideoClips({
        clips,
        audioBuffer: audioData.buffer,
        audioExt: audioData.ext,
        totalDuration: plan.targetOutputDuration,
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

    await updateJobStatus(job.id, { status: "ready", progressPercent: 100, videoId });
    logger.info({ jobId: job.id, videoId, provider: getActiveProvider() }, "Job completed");
  } catch (err) {
    await retryOrFail(job, err);
  }
}

let isRunning = false;

export async function startJobProcessor(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  logger.info("Job processor started");

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
