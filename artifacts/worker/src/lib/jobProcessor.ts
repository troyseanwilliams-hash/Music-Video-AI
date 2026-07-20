import { db } from "@workspace/db";
import { jobsTable, videosTable, creditsTable } from "@workspace/db";
import type { VideoClipMeta } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
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
import { generateClip, downloadClip, getActiveProvider } from "./videoApis.js";
import { stitchVideoClips, extractVideoThumbnail } from "./videoStitcher.js";
import { stitchEditorTimeline } from "./editorStitcher.js";
import { calculateEditorCost } from "./editorCost.js";
import { calculateCreditCost } from "./creditCost.js";

const execAsync = promisify(exec);
const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5000;
// For "full" mode only: cap at 3 clips to keep costs predictable.
// Numeric durations (5/10/30/60/90/120s) derive their clip count dynamically
// via Math.ceil(durSec / clipDurationSec) and cycle sections as needed —
// so 90s → 9 clips and 120s → 12 clips work correctly without this cap.
const FULL_MODE_MAX_CLIPS = 3;

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
    const selected = sections.length <= FULL_MODE_MAX_CLIPS
      ? sections
      : (() => {
          const sorted = [...sections].sort((a, b) => b.energy - a.energy);
          const picked = new Set<number>();
          picked.add(sections.indexOf(sorted[0]!));
          picked.add(0);
          picked.add(sections.length - 1);
          return Array.from(picked).sort((a, b) => a - b).map((i) => sections[i]!).slice(0, FULL_MODE_MAX_CLIPS);
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

  const rows = (result as unknown as { rows: { id: string }[] }).rows;
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
    const filename = job.audioObjectPath.split("/").pop() ?? "";
    const dotIndex = filename.lastIndexOf(".");
    const rawExt = dotIndex !== -1 ? filename.slice(dotIndex + 1).toLowerCase() : "";
    const ext = rawExt.length > 0 && rawExt.length <= 5 ? rawExt : "mp3";
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
  plan: GenerationPlan,
  onProgress: (pct: number) => Promise<void>,
): Promise<{ buffer: Buffer; targetDuration: number; prompt: string }[]> {
  const provider = getActiveProvider((job as JobRow & { aiProvider?: string | null }).aiProvider ?? undefined);
  const { sections, clipDurationSec } = plan;
  const clips: { buffer: Buffer; targetDuration: number; prompt: string }[] = [];
  const refImageUrl = await loadReferenceImageUrl(job);

  logger.info(
    { jobId: job.id, provider, sectionCount: sections.length, clipDurationSec, targetOutputDuration: plan.targetOutputDuration },
    "Generating clips per plan",
  );

  // Distribute the total output duration evenly across clips.
  // Do NOT use section.endTime - section.startTime: when the audio-clip
  // extraction fails or MP3 headers report the wrong total length, section
  // timestamps reflect the full audio file instead of the requested window,
  // causing each Runway clip to be looped for the entire song duration.
  const perClipTargetDuration = plan.targetOutputDuration / sections.length;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const targetDuration = Math.max(1, perClipTargetDuration);
    const clipDuration = clipDurationSec;

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
    void notifyRenderFailed(job, errMsg);
  }
}

type ExtendedJobRow = JobRow & {
  requestedDuration?: string | null;
  clipStartTime?: number | null;
};

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
  resolution?: string; // "720p" | "1080p"
  watermark?: boolean;
  chargeCredits?: boolean; // true only when trial ended and not subscribed
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

    // Pull each segment's bytes from object storage.
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

    const [width, height] =
      manifest.resolution === "4k" ? [3840, 2160] :
      manifest.resolution === "1080p" ? [1920, 1080] : [1280, 720];
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
    if (result.skipped.length) {
      logger.warn({ jobId: job.id, skipped: result.skipped.length }, "Some segments were skipped");
    }
    if (result.transitionsDisabled) {
      logger.info(
        { jobId: job.id, segments: segments.length },
        "Transitions disabled for long timeline — used hard-cut concat",
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
      logger.info({ jobId: job.id, creditCost }, "Editor credits deducted on success");
    }

    await updateJobStatus(job.id, { status: "ready", progressPercent: 100, videoId });
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
          const result = await generateClip({
            prompt,
            durationSeconds: duration,
            aspectRatio: job.aspectRatio ?? "16:9",
          });
          buffer = result ? await downloadClip(result.videoUrl) : await createSimulationClip(duration);
        }
        built.push({ buffer, targetDuration: clip.durationSec, prompt, style: styleKey });
        processed++;
        await updateJobStatus(job.id, {
          progressPercent: 10 + Math.floor((processed / regen.size) * 60),
        });
      } else {
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
  // Studio timeline renders take a completely different path from AI generation.
  if (job.jobType === "editor_render") {
    await processEditorJob(job);
    return;
  }
  if (job.jobType === "remix") {
    await processRemixJob(job);
    return;
  }

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

    // Deduct credits on success. Subscription bucket is drawn first so one-time
    // top-ups survive monthly plan resets.
    const creditCost = calculateCreditCost(job.requestedDuration, job.resolution);
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
