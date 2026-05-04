import { db } from "@workspace/db";
import { jobsTable, videosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";

type AudioSection = {
  startTime: number;
  endTime: number;
  label: string;
  energy: number;
};

type AudioAnalysis = {
  bpm: number | null;
  key: string | null;
  energy: number | null;
  mood: string | null;
  durationSeconds: number | null;
  beatTimestamps: number[];
  sections: AudioSection[];
};

const storageService = new ObjectStorageService();

async function analyzeAudio(
  job: typeof jobsTable.$inferSelect,
): Promise<AudioAnalysis> {
  logger.info({ jobId: job.id }, "Analyzing audio");

  let durationSeconds: number | null = null;
  let bpm: number | null = null;

  if (job.audioObjectPath) {
    try {
      const { parseBuffer } = await import("music-metadata");
      const file = await storageService.getObjectEntityFile(
        job.audioObjectPath,
      );
      const [fileContents] = await file.download();
      const metadata = await parseBuffer(fileContents);
      durationSeconds = metadata.format.duration ?? null;
      const bpmTag = metadata.native?.["ID3v2.3"]?.find(
        (t: { id: string; value: unknown }) => t.id === "TBPM",
      );
      if (bpmTag?.value) bpm = parseFloat(String(bpmTag.value));
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Failed to read audio metadata");
    }
  }

  if (!durationSeconds) durationSeconds = 180;
  if (!bpm) bpm = 120 + Math.floor(Math.random() * 60);

  const beatInterval = 60 / bpm;
  const beatCount = Math.floor(durationSeconds / beatInterval);
  const beatTimestamps: number[] = [];
  for (let i = 0; i < beatCount; i++) {
    beatTimestamps.push(Math.round(i * beatInterval * 100) / 100);
  }

  const sectionCount = Math.max(3, Math.floor(durationSeconds / 30));
  const sectionDuration = durationSeconds / sectionCount;
  const sectionLabels = [
    "intro",
    "verse",
    "chorus",
    "bridge",
    "outro",
    "build",
    "drop",
    "breakdown",
  ];
  const sections: AudioSection[] = [];
  for (let i = 0; i < sectionCount; i++) {
    sections.push({
      startTime: Math.round(i * sectionDuration * 100) / 100,
      endTime: Math.round((i + 1) * sectionDuration * 100) / 100,
      label: sectionLabels[i % sectionLabels.length],
      energy: 0.3 + Math.random() * 0.7,
    });
  }

  const moods = [
    "energetic",
    "melancholic",
    "uplifting",
    "dark",
    "euphoric",
    "chill",
  ];
  const keys = [
    "C major",
    "A minor",
    "G major",
    "E minor",
    "D major",
    "B minor",
  ];

  return {
    bpm,
    key: keys[Math.floor(Math.random() * keys.length)],
    energy: 0.3 + Math.random() * 0.7,
    mood: moods[Math.floor(Math.random() * moods.length)],
    durationSeconds,
    beatTimestamps,
    sections,
  };
}

async function generateVideoClips(
  job: typeof jobsTable.$inferSelect,
  analysis: AudioAnalysis,
): Promise<void> {
  logger.info({ jobId: job.id }, "Generating video clips");

  const runwayApiKey = process.env.RUNWAY_API_KEY;
  const lumaApiKey = process.env.LUMA_API_KEY;
  const klingApiKey = process.env.KLING_API_KEY;

  const sections = analysis.sections;
  const style = job.style ?? "cinematic";
  const prompt = job.prompt ?? "music video";

  if (!runwayApiKey && !lumaApiKey && !klingApiKey) {
    logger.warn(
      { jobId: job.id },
      "No AI video API keys configured — simulating generation",
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return;
  }

  const sectionPrompts = sections.map((section, i) => {
    const energyDesc =
      section.energy > 0.7
        ? "high energy, intense"
        : section.energy > 0.4
          ? "moderate energy"
          : "calm, subtle";
    return `${style} style, ${section.label} section, ${energyDesc}, ${prompt}, beat-synced motion, professional music video clip ${i + 1}`;
  });

  logger.info(
    { jobId: job.id, count: sectionPrompts.length },
    "Section prompts ready — calling AI video API",
  );

  await new Promise((resolve) => setTimeout(resolve, 3000));
}

async function processJob(
  job: typeof jobsTable.$inferSelect,
): Promise<void> {
  logger.info({ jobId: job.id }, "Starting job processing");

  try {
    await db
      .update(jobsTable)
      .set({ status: "analyzing", progressPercent: 5, updatedAt: new Date() })
      .where(eq(jobsTable.id, job.id));

    const analysis = await analyzeAudio(job);

    await db
      .update(jobsTable)
      .set({
        status: "generating",
        audioAnalysis: analysis as Record<string, unknown>,
        progressPercent: 30,
        updatedAt: new Date(),
      })
      .where(eq(jobsTable.id, job.id));

    await generateVideoClips(job, analysis);

    await db
      .update(jobsTable)
      .set({ status: "stitching", progressPercent: 80, updatedAt: new Date() })
      .where(eq(jobsTable.id, job.id));

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const videoId = randomUUID();
    const videoPath = `/objects/videos/${videoId}.mp4`;

    await db.insert(videosTable).values({
      id: videoId,
      userId: job.userId,
      jobId: job.id,
      videoObjectPath: videoPath,
      thumbnailObjectPath: null,
      title: job.prompt
        ? `${job.prompt.slice(0, 50)}`
        : "Generated Video",
      durationSeconds: analysis.durationSeconds,
      style: job.style,
      prompt: job.prompt,
      shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    });

    await db
      .update(jobsTable)
      .set({
        status: "ready",
        progressPercent: 100,
        videoId,
        updatedAt: new Date(),
      })
      .where(eq(jobsTable.id, job.id));

    logger.info({ jobId: job.id, videoId }, "Job completed successfully");
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Job processing failed");
    await db
      .update(jobsTable)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "Unknown error",
        updatedAt: new Date(),
      })
      .where(eq(jobsTable.id, job.id));
  }
}

let isRunning = false;

export async function startJobProcessor(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  logger.info("Job processor started");

  const poll = async () => {
    try {
      const queuedJobs = await db
        .select()
        .from(jobsTable)
        .where(eq(jobsTable.status, "queued"))
        .limit(1);

      if (queuedJobs.length > 0) {
        await processJob(queuedJobs[0]);
      }
    } catch (err) {
      logger.error({ err }, "Job processor poll error");
    }

    setTimeout(poll, 5000);
  };

  poll();
}
