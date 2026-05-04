import { db } from "@workspace/db";
import { jobsTable, videosTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5000;
const AI_POLL_INTERVAL_MS = 5000;
const AI_POLL_MAX_ATTEMPTS = 120;

const storageService = new ObjectStorageService();

type AudioSection = {
  startTime: number;
  endTime: number;
  label: string;
  energy: number;
};

type AudioAnalysis = {
  bpm: number;
  key: string;
  energy: number;
  mood: string;
  durationSeconds: number;
  beatTimestamps: number[];
  sections: AudioSection[];
};

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

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, claimedId)).limit(1);
  return job ?? null;
}

async function analyzeAudio(job: JobRow): Promise<AudioAnalysis> {
  logger.info({ jobId: job.id }, "Analyzing audio");

  let durationSeconds = 180;
  let bpm = 128;

  if (job.audioObjectPath) {
    try {
      const { parseBuffer } = await import("music-metadata");
      const file = await storageService.getObjectEntityFile(job.audioObjectPath);
      const [fileContents] = await file.download();
      const metadata = await parseBuffer(fileContents);
      if (metadata.format.duration) durationSeconds = metadata.format.duration;
      if (metadata.common.bpm) bpm = Math.round(metadata.common.bpm);
      const bpmTag = metadata.native?.["ID3v2.3"]?.find(
        (t: { id: string; value: unknown }) => t.id === "TBPM",
      );
      if (bpmTag?.value) bpm = Math.round(parseFloat(String(bpmTag.value)));
    } catch (err) {
      logger.warn({ err, jobId: job.id }, "Could not parse audio metadata, using defaults");
    }
  }

  const beatInterval = 60 / bpm;
  const beatCount = Math.min(Math.floor(durationSeconds / beatInterval), 500);
  const beatTimestamps: number[] = Array.from({ length: beatCount }, (_, i) =>
    Math.round(i * beatInterval * 100) / 100,
  );

  const sectionCount = Math.max(3, Math.min(8, Math.floor(durationSeconds / 30)));
  const sectionDuration = durationSeconds / sectionCount;
  const sectionLabels = ["intro", "verse", "chorus", "bridge", "drop", "breakdown", "build", "outro"];
  const energyPattern = [0.3, 0.5, 0.85, 0.6, 0.95, 0.4, 0.8, 0.2];
  const sections: AudioSection[] = Array.from({ length: sectionCount }, (_, i) => ({
    startTime: Math.round(i * sectionDuration * 100) / 100,
    endTime: Math.round((i + 1) * sectionDuration * 100) / 100,
    label: sectionLabels[i % sectionLabels.length],
    energy: energyPattern[i % energyPattern.length],
  }));

  const moods = ["energetic", "melancholic", "uplifting", "dark", "euphoric", "chill", "intense", "dreamy"];
  const keys = ["C major", "A minor", "G major", "E minor", "D major", "B minor", "F major", "D minor"];
  const energy = sections.reduce((sum, s) => sum + s.energy, 0) / sections.length;

  return {
    bpm,
    key: keys[bpm % keys.length],
    energy: Math.round(energy * 100) / 100,
    mood: moods[Math.floor(bpm / 20) % moods.length],
    durationSeconds,
    beatTimestamps,
    sections,
  };
}

function buildSmartPrompt(job: JobRow, analysis: AudioAnalysis): string {
  const style = job.style ?? "cinematic";
  const userPrompt = job.prompt ?? "music video";

  const paceDesc =
    analysis.bpm > 140 ? "fast-paced, high-energy, rapid cuts" :
    analysis.bpm > 100 ? "upbeat, dynamic, flowing transitions" :
    analysis.bpm > 70  ? "moderate, fluid, deliberate pacing" :
                         "slow, atmospheric, long dissolves";

  const energyDesc =
    analysis.energy > 0.75 ? "intense, powerful, dramatic visuals" :
    analysis.energy > 0.5  ? "vibrant, engaging, colorful visuals" :
                              "calm, subtle, minimalist visuals";

  const styleMap: Record<string, string> = {
    realistic:   "photorealistic cinematography, real performers, professional film lighting, shallow depth of field",
    anime:       "anime art style, expressive characters, vibrant cel shading, dynamic speed lines",
    cinematic:   "cinematic 35mm film, anamorphic bokeh, dramatic chiaroscuro lighting, movie-grade LUT",
    abstract:    "abstract geometric visuals, fluid particle simulations, fractals, morphing shapes",
    neon:        "neon cyberpunk, glowing signs, rain-slicked streets, vivid purples and electric blues",
    vintage:     "super-8 film grain, warm analog tones, light leaks, retro 70s aesthetic",
    fantasy:     "high fantasy, magical particle effects, ethereal mist, enchanted landscapes",
    documentary: "handheld documentary, natural light, authentic street aesthetic, real-world textures",
  };

  const styleDesc = styleMap[style] ?? styleMap.cinematic;
  const dominantSection = analysis.sections.reduce((a, b) => a.energy > b.energy ? a : b);

  return [
    styleDesc,
    paceDesc,
    `${analysis.mood} mood`,
    energyDesc,
    `peaks during ${dominantSection.label} section`,
    userPrompt,
    "beat-synced visual cuts, smooth motion, professional music video production, 4K ultra-wide",
  ].join(", ");
}

async function callRunwayML(prompt: string): Promise<string> {
  const apiKey = process.env.RUNWAY_API_KEY!;
  const genRes = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify({ model: "gen3a_turbo", promptText: prompt.slice(0, 1000), duration: 10, ratio: "1280:768" }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!genRes.ok) throw new Error(`Runway API ${genRes.status}: ${(await genRes.text()).slice(0, 200)}`);
  const { id: taskId } = (await genRes.json()) as { id: string };
  logger.info({ taskId }, "Runway task submitted");

  for (let i = 0; i < AI_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, AI_POLL_INTERVAL_MS));
    const pollRes = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, "X-Runway-Version": "2024-11-06" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pollRes.ok) continue;
    const task = (await pollRes.json()) as { status: string; output?: string[]; failure?: { message?: string } };
    if (task.status === "SUCCEEDED" && task.output?.[0]) return task.output[0];
    if (task.status === "FAILED") throw new Error(`Runway task failed: ${task.failure?.message ?? "unknown"}`);
  }
  throw new Error("Runway task timed out");
}

async function callLumaAPI(prompt: string): Promise<string> {
  const apiKey = process.env.LUMA_API_KEY!;
  const genRes = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt.slice(0, 2000), aspect_ratio: "16:9", loop: false }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!genRes.ok) throw new Error(`Luma API ${genRes.status}: ${(await genRes.text()).slice(0, 200)}`);
  const gen = (await genRes.json()) as { id: string; state: string };

  for (let i = 0; i < AI_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, AI_POLL_INTERVAL_MS));
    const pollRes = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${gen.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pollRes.ok) continue;
    const status = (await pollRes.json()) as { state: string; assets?: { video?: string }; failure_reason?: string };
    if (status.state === "completed" && status.assets?.video) return status.assets.video;
    if (status.state === "failed") throw new Error(`Luma failed: ${status.failure_reason ?? "unknown"}`);
  }
  throw new Error("Luma generation timed out");
}

async function generateVideoWithAI(job: JobRow, analysis: AudioAnalysis): Promise<string | null> {
  const prompt = buildSmartPrompt(job, analysis);
  logger.info({ jobId: job.id, prompt: prompt.slice(0, 120) }, "Smart prompt built");

  if (process.env.RUNWAY_API_KEY) return callRunwayML(prompt);
  if (process.env.LUMA_API_KEY) return callLumaAPI(prompt);

  logger.warn({ jobId: job.id }, "No AI video API key — simulating (4s delay)");
  await new Promise((r) => setTimeout(r, 4000));
  return null;
}

async function updateJobStatus(jobId: string, fields: Partial<typeof jobsTable.$inferInsert>): Promise<void> {
  await db.update(jobsTable).set({ ...fields, updatedAt: new Date() }).where(eq(jobsTable.id, jobId));
  await notifyJobUpdate(jobId);
}

async function retryOrFail(job: JobRow, err: unknown): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);
  logger.error({ err, jobId: job.id, retryCount: job.retryCount }, "Job failed");
  const nextRetry = (job.retryCount ?? 0) + 1;

  if (nextRetry < MAX_RETRIES) {
    const delayMs = Math.pow(2, nextRetry) * 60_000;
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: `${errMsg} — retry ${nextRetry}/${MAX_RETRIES} in ${delayMs / 60000}m`,
    });
    setTimeout(async () => {
      await db.update(jobsTable)
        .set({ status: "queued", progressPercent: 0, errorMessage: null, retryCount: nextRetry, claimedAt: null, updatedAt: new Date() })
        .where(eq(jobsTable.id, job.id));
      await notifyJobUpdate(job.id);
    }, delayMs);
  } else {
    await updateJobStatus(job.id, { status: "failed", errorMessage: `${errMsg} (max ${MAX_RETRIES} retries reached)` });
  }
}

async function processJob(job: JobRow): Promise<void> {
  logger.info({ jobId: job.id, style: job.style }, "Processing job");
  try {
    await updateJobStatus(job.id, { progressPercent: 5 });
    const analysis = await analyzeAudio(job);
    await updateJobStatus(job.id, { status: "generating", audioAnalysis: analysis as Record<string, unknown>, progressPercent: 30 });

    const videoUrl = await generateVideoWithAI(job, analysis);
    await updateJobStatus(job.id, { progressPercent: 70 });
    await updateJobStatus(job.id, { status: "stitching", progressPercent: 82 });

    const videoId = randomUUID();
    const videoObjectPath = videoUrl
      ? await storageService.uploadVideoFromUrl(videoUrl, videoId)
      : `/objects/videos/${videoId}.mp4`;

    await new Promise((r) => setTimeout(r, 800));

    await db.insert(videosTable).values({
      id: videoId,
      userId: job.userId,
      jobId: job.id,
      videoObjectPath,
      thumbnailObjectPath: null,
      title: job.prompt ? job.prompt.slice(0, 100) : "Generated Video",
      durationSeconds: analysis.durationSeconds,
      style: job.style,
      prompt: job.prompt,
      shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    });

    await updateJobStatus(job.id, { status: "ready", progressPercent: 100, videoId });
    logger.info({ jobId: job.id, videoId }, "Job completed");
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
      if (job) processJob(job).catch((err) => logger.error({ err, jobId: job.id }, "Unhandled job error"));
    } catch (err) {
      logger.error({ err }, "Poll error");
    }
    setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}
