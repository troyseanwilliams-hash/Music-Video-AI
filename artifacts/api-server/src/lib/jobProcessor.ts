import { db, getResourceLeaseExecutionContext, runWithResourceLeaseExecutionContext, withResourceLease } from "@workspace/db";
import { jobsTable, videosTable, creditsTable, imageAssetsTable } from "@workspace/db";
import type { VideoClipMeta } from "@workspace/db";
import { eq, and, sql, count, isNull } from "drizzle-orm";
import { getClipPlan, MAX_FULL_SECONDS, GENERATED_IMAGE_CREDITS_PER_VISUAL } from "./creditCost.js";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { hostname, tmpdir } from "os";
import { logger } from "./logger.js";
import { notifyRenderReady, notifyAdminRenderFailed } from "./renderEmail.js";
import { ObjectStorageService } from "./objectStorage.js";
import { analyzeAudioBuffer, type AudioAnalysis, type AudioSection } from "./audioAnalysis.js";
import { generateClip, downloadClip, pollPixazoRequestUntilComplete, getActiveProvider, PROVIDER_API_FAILURE, PROVIDER_TERMINAL_FAILURE, PROVIDER_OUT_OF_CREDITS, PROVIDER_POLL_TIMEOUT, PROVIDER_POLL_ABORTED, PROVIDER_MEDIA_TERMINAL } from "./videoApis.js";
import {
  generateNarrativeImage,
  downloadGeneratedImage,
  IMAGE_API_FAILURE,
  IMAGE_POLL_TIMEOUT,
  isImageModerationRejection,
  stricterFamilyFriendlyImagePrompt,
} from "./imageApis.js";
import { generateLipsync, lipsyncAvailable } from "./lipsync.js";
import { stitchVideoClips, extractVideoThumbnail, createWebPreview } from "./videoStitcher.js";
import { stitchEditorTimeline } from "./editorStitcher.js";
import { resolveMontageSequence, resolveStrictMontageSequence } from "./montageSequence.js";
import { assertStrictUniqueMedia, perceptualFingerprint } from "./mediaUniqueness.js";
import {
  resolveCharacterReferencePath,
  selectGeneratedCharacterAnchorPath,
} from "./characterAnchor.js";
import { imageFirstAutomaticRetryCost, settleImageFirstReservation } from "./imageFirstSettlement.js";
import { hasCompleteSavedClipSet } from "./finalizeSavedClips.js";
import { retryNoChargeOperation } from "./noChargeRetry.js";
import {
  lazyBuffer,
  materializeLazyBuffers,
  pendingFirstOrder,
  resolveSceneConcurrency,
  runBoundedScenes,
} from "./clipGenerationScheduler.js";
import {
  INFRASTRUCTURE_RETRY,
  MAX_NO_CHARGE_POLL_RECOVERIES,
  isTransientInfrastructureError,
  planNoChargePollRecovery,
  recoverableInfrastructureError,
  savedOutputsCoverEveryScene,
} from "./infrastructureRetry.js";
import { processPodcastJob } from "./podcastProcessor.js";
import { processNarrationJob } from "./narrationProcessor.js";
import {
  ASSEMBLY_DEADLINE_EXCEEDED,
  createJobRunSupervisor,
  type JobRunSupervisor,
} from "./jobRunSupervisor.js";

const execAsync = promisify(exec);
const MAX_RETRIES = 3;
const MAX_INFRASTRUCTURE_RETRIES = 24;
const PREVIEW_TARGET_GONE = "preview backfill target no longer exists";
const POLL_INTERVAL_MS = 5000;
const NO_CHARGE_CLIP_READ_DELAYS_MS = [2_000, 5_000, 10_000, 20_000] as const;

const storageService = new ObjectStorageService();
const activeClaimTokens = new Map<string, Date>();
type JobRow = typeof jobsTable.$inferSelect;

async function createAndUploadWebPreview(
  videoBuffer: Buffer,
  videoId: string,
  durationSeconds: number,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const previewBuffer = await createWebPreview(videoBuffer, durationSeconds);
    signal?.throwIfAborted();
    const path = await storageService.uploadVideoPreviewBuffer(previewBuffer, videoId);
    logger.info(
      { videoId, masterBytes: videoBuffer.length, previewBytes: previewBuffer.length },
      "Web preview rendition stored",
    );
    return path;
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    logger.warn({ err, videoId }, "Web preview rendition failed; preserving completed master");
    return null;
  }
}

async function finalizePreviewBackfill(
  job: JobRow,
  videoId: string,
  previewObjectPath: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [video] = await tx
      .select({ id: videosTable.id })
      .from(videosTable)
      .where(eq(videosTable.id, videoId))
      .limit(1)
      .for("update");
    if (!video) throw new Error(PREVIEW_TARGET_GONE);

    const completed = await tx
      .update(jobsTable)
      .set({ status: "ready", progressPercent: 100, claimedAt: null, updatedAt: new Date() })
      .where(and(
        eq(jobsTable.id, job.id),
        eq(jobsTable.claimedAt, job.claimedAt!),
        eq(jobsTable.jobType, "preview_backfill"),
      ))
      .returning({ id: jobsTable.id });
    if (completed.length === 0) throw new Error(OWNERSHIP_LOST);

    await tx
      .update(videosTable)
      .set({ previewObjectPath })
      .where(and(eq(videosTable.id, videoId), isNull(videosTable.previewObjectPath)));
  });
}

async function readClipWithNoChargeRetry(
  job: JobRow,
  clipIndex: number,
  source: string,
  operation: () => Promise<Buffer>,
): Promise<Buffer> {
  return retryNoChargeOperation(async () => {
    await assertJobOwned(job);
    return operation();
  }, {
    delaysMs: NO_CHARGE_CLIP_READ_DELAYS_MS,
    shouldRetry: (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      return !detail.includes(OWNERSHIP_LOST) && !detail.includes(PROVIDER_MEDIA_TERMINAL);
    },
    onRetry: (err, nextAttempt, delayMs) => {
      logger.warn(
        { jobId: job.id, clip: clipIndex, source, err, nextAttempt, delayMs },
        "Saved video read failed temporarily — retrying the same output at no charge",
      );
    },
  });
}

const WORKER_ID = process.env.WORKER_ID?.trim() || `${hostname()}-${process.pid}`;
const WORKER_CAPACITY = 1;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;
const WORKER_METRICS_INTERVAL_MS = (() => {
  const parsed = Number.parseInt(process.env.WORKER_METRICS_INTERVAL_MS ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 30_000
    ? Math.min(parsed, 600_000)
    : 60_000;
})();

export type JobProcessorStatus = {
  workerId: string;
  state: "starting" | "ready" | "draining" | "stopped";
  capacity: number;
  activeJobs: number;
  activeJobIds: string[];
  jobsStarted: number;
  jobsCompleted: number;
  jobsFailed: number;
  startedAt: string | null;
};

type QueueMetrics = {
  queued: number;
  active: number;
  retrying: number;
  stale: number;
  oldestQueuedAt: string | null;
  oldestQueuedAgeMs: number | null;
  database: "ok" | "degraded";
};

let processorState: JobProcessorStatus = {
  workerId: WORKER_ID,
  state: "stopped",
  capacity: WORKER_CAPACITY,
  activeJobs: 0,
  activeJobIds: [],
  jobsStarted: 0,
  jobsCompleted: 0,
  jobsFailed: 0,
  startedAt: null,
};
let processorBusy = false;
let pollTimer: NodeJS.Timeout | null = null;
let recoveryTimer: NodeJS.Timeout | null = null;
let metricsTimer: NodeJS.Timeout | null = null;
let currentJobPromise: Promise<void> | null = null;
let pollInFlight: Promise<void> | null = null;

function targetOutputDuration(
  requestedDuration: string | null | undefined,
  audioDurationSeconds: number,
): number {
  if (!requestedDuration || requestedDuration === "full") {
    return Math.min(Math.max(audioDurationSeconds, 1), MAX_FULL_SECONDS);
  }
  const requested = parseInt(requestedDuration, 10);
  return Number.isFinite(requested) && requested > 0 ? requested : 10;
}

// Extract [startSec, startSec + durationSec) as an audio-only MP3. Re-encoding
// makes embedded MP4 soundtracks and uploaded audio share one provider-safe
// container instead of accidentally forwarding a video stream. The Lip Sync
// service accepts MP3/WAV inputs but rejects M4A.
async function extractAudioClip(
  audio: { buffer: Buffer; ext: string },
  startSec: number,
  durationSec: number,
): Promise<{ buffer: Buffer; ext: string }> {
  const id = randomUUID();
  const inputPath = join(tmpdir(), `bv_in_${id}.${audio.ext}`);
  const outputPath = join(tmpdir(), `bv_clip_${id}.mp3`);
  try {
    await writeFile(inputPath, audio.buffer);
    await withResourceLease("ffmpeg_light", ({ signal }) => execAsync(
      `ffmpeg -y -ss ${startSec.toFixed(3)} -t ${durationSec} -i "${inputPath}" -map 0:a:0 -vn -c:a libmp3lame -b:a 192k "${outputPath}"`,
      { timeout: 30_000, signal },
    ));
    const { readFile } = await import("fs/promises");
    const clipped = await readFile(outputPath);
    return { buffer: clipped, ext: "mp3" };
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

// ---- AI-video billing + clip-salvage state ---------------------------------
// AI jobs stash billing/salvage state in the (otherwise unused for AI jobs)
// manifest jsonb: credits are RESERVED up front at job creation and refunded
// here on permanent failure; successfully rendered clips are persisted so a
// job retry only regenerates the ones that failed (no re-paying for the rest).
type PersistedStoryboardShot = {
  index: number;
  label: string;
  startTime: number;
  energy: number;
  usesCharacterReference?: boolean;
  prompt: string;
};

type GeneratedClip = {
  buffer: Buffer;
  loadBuffer?: () => Promise<Buffer>;
  targetDuration: number;
  prompt: string;
  visualIndex: number;
};

type UncertainSubmission = {
  provider: string;
  status?: number;
  activityId?: string;
  reason: string;
  occurredAt: string;
};

type RejectedClipRequest = {
  pollUrl: string;
  reason: string;
  occurredAt: string;
};

type ClipSubmissionIntent = {
  provider: string;
  occurredAt: string;
};

type PendingImageRequest = {
  requestId: string;
  pollUrl: string;
};

type ImageSubmissionIntent = {
  occurredAt: string;
};

type ImageReviewScene = {
  index: number;
  canonicalPath?: string;
  revision: number;
  source: "original_generation" | "regenerated" | "generated_gallery" | "local_upload";
  prompt: string;
  status?: "ready" | "failed" | "pending" | "uncertain";
  errorMessage?: string;
  acceptedRequestId?: string;
};

type ImageReviewState = {
  phase: "awaiting_approval" | "approved";
  revision: number;
  approvedRevision?: number;
  scenes: Record<string, ImageReviewScene>;
  pendingReplacements?: Record<string, {
    id: string;
    index: number;
    prompt: string;
    credits: number;
    subscriptionCredits: number;
    topupCredits: number;
    status: "queued" | "processing" | "uncertain";
    createdAt: string;
  }>;
};

type UncertainImageSubmission = {
  status?: number;
  activityId?: string;
  reason: string;
  occurredAt: string;
};

type ImageGenerationFailure = {
  status: "failed" | "pending" | "uncertain";
  message: string;
  occurredAt: string;
};

type ImageSafetyRetry = {
  authorizedAt: string;
  reason: string;
  fallbackPrompt: string;
  exhaustedAt?: string;
};

type AiJobMeta = {
  strictUniqueSourcesVersion?: number;
  generationMode?: "montage" | "narrative";
  narrativeVisualSource?: "video" | "generated_images";
  narrativeImages?: Record<string, string>;
  pendingImageRequests?: Record<string, PendingImageRequest>;
  imageSubmissionIntents?: Record<string, ImageSubmissionIntent>;
  uncertainImageSubmissions?: Record<string, UncertainImageSubmission>;
  imageGenerationFailures?: Record<string, ImageGenerationFailure>;
  imageSafetyRetries?: Record<string, ImageSafetyRetry>;
  imageFirstVersion?: number;
  imageReview?: ImageReviewState;
  reservedCredits?: number;
  reservedSubscriptionCredits?: number;
  reservedTopupCredits?: number;
  refunded?: boolean;
  lipSyncPollUrl?: string;
  partialClips?: Record<string, string>; // clip index -> object storage path
  pendingRequests?: Record<string, string>; // clip index -> provider poll URL (submitted, not yet downloaded)
  rejectedRequests?: Record<string, RejectedClipRequest>; // terminal provider rejection; admin may authorize one fresh submission
  uncertainSubmissions?: Record<string, UncertainSubmission>; // clip index -> ambiguous submit outcome requiring explicit acknowledgement
  providerPollRecoveryCount?: number; // bounded GET-only recovery attempts; never authorizes a new provider POST
  imagePollRecoveryCount?: number; // bounded GET-only image recovery attempts; never authorizes a new provider POST
  submissionIntents?: Record<string, ClipSubmissionIntent>; // written before POST; unresolved entries block automatic resubmission
  targetedSceneRecovery?: {
    sceneIndex: number;
    assetType: "clip";
    allowTerminalSkip: true;
    terminalFallbackProvider: "kling";
    requestedAt: string;
  }; // explicit admin recovery: this exact storyboard segment must be the next paid request
  retryAfter?: number; // epoch ms — queued job must not be claimed before this
  finalizeWithPartial?: boolean; // admin: stitch whatever clips exist, never call the provider
  completeSavedClipRecovery?: boolean; // admin: skip image/provider preparation and stitch a complete saved clip set
  storyboard?: {
    generationMode?: "montage" | "narrative";
    numClips?: number;
    clipDurationSec?: number;
    targetOutputDuration?: number;
    shots?: unknown[];
    timeline?: unknown[];
  };
  baseCreditCost?: number;
  baseReservedSubscriptionCredits?: number;
  baseReservedTopupCredits?: number;
  bundledLipSyncEnabled?: boolean;
  bundledLipSyncChildId?: string;
  bundledLipSyncCost?: number;
  bundledLipSyncReservedSubscriptionCredits?: number;
  bundledLipSyncReservedTopupCredits?: number;
  bundledLipSyncActivated?: boolean;
  selectedSceneSources?: Record<string, { sourceImageAssetId?: string }>;
  photoAnimation?: {
    version: 1;
    approved: true;
    approvedPrompt: string;
    sourceObjectPath: string;
    durationSeconds: 5 | 10;
  };
};

function aiMetaOf(job: JobRow): AiJobMeta {
  const m = (job as JobRow & { manifest?: unknown }).manifest;
  return m && typeof m === "object" ? (m as AiJobMeta) : {};
}

function generationModeOf(job: JobRow): "montage" | "narrative" {
  const meta = aiMetaOf(job);
  return meta.generationMode === "narrative"
    || meta.storyboard?.generationMode === "narrative"
    ? "narrative"
    : "montage";
}

function usesGeneratedNarrativeImages(job: JobRow): boolean {
  const meta = aiMetaOf(job);
  return meta.imageFirstVersion === 1 && meta.narrativeVisualSource === "generated_images";
}

export function approvedPhotoAnimation(job: JobRow): AiJobMeta["photoAnimation"] | null {
  const feature = aiMetaOf(job).photoAnimation;
  if (
    feature?.version !== 1
    || feature.approved !== true
    || !feature.approvedPrompt
    || !feature.sourceObjectPath.startsWith("/objects/")
    || (feature.durationSeconds !== 5 && feature.durationSeconds !== 10)
  ) return null;
  return feature;
}

function isAwaitingImageApproval(meta: AiJobMeta): boolean {
  return meta.imageReview?.phase === "awaiting_approval";
}

async function persistInitialImageReview(
  jobId: string,
  shots: PersistedStoryboardShot[],
  paths: Record<string, string>,
  selectedSceneSources: Record<string, { sourceImageAssetId?: string }> = {},
  failures: Record<string, ImageGenerationFailure> = {},
): Promise<void> {
  const scenes = Object.fromEntries(shots.map((shot) => [
    String(shot.index),
    {
      index: shot.index,
      ...(paths[shot.index] ? { canonicalPath: paths[shot.index] } : {}),
      revision: 1,
      source: selectedSceneSources[String(shot.index)] ? "generated_gallery" : "original_generation",
      prompt: shot.prompt,
      status: paths[shot.index] ? "ready" : (failures[String(shot.index)]?.status ?? "failed"),
      ...(failures[String(shot.index)]?.message
        ? { errorMessage: failures[String(shot.index)]!.message }
        : {}),
    },
  ]));
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
      COALESCE(manifest, '{}'::jsonb),
      '{imageReview}',
      ${JSON.stringify({
        phase: "awaiting_approval",
        revision: 1,
        scenes,
      })}::jsonb
    ),
    status = 'pending_approval',
    claimed_at = NULL,
    updated_at = NOW()
    WHERE id = ${jobId}
      AND manifest->>'imageFirstVersion' = '1'
  `);
  await notifyJobUpdate(jobId);
}

async function persistNarrativeImages(jobId: string, paths: Record<string, string>): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
      COALESCE(manifest, '{}'::jsonb),
      '{narrativeImages}',
       COALESCE(manifest->'narrativeImages', '{}'::jsonb) || ${JSON.stringify(paths)}::jsonb
    ), updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function persistPendingImageRequest(
  jobId: string,
  index: number,
  info: PendingImageRequest,
): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
      jsonb_set(
        COALESCE(manifest, '{}'::jsonb),
        '{pendingImageRequests}',
        COALESCE(manifest->'pendingImageRequests', '{}'::jsonb)
          || ${JSON.stringify({ [index]: info })}::jsonb
      ),
      '{imageSubmissionIntents}',
      COALESCE(manifest->'imageSubmissionIntents', '{}'::jsonb) - ${String(index)}
    ), updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function persistImageSubmissionIntent(job: JobRow, index: number): Promise<boolean> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
      COALESCE(manifest, '{}'::jsonb),
      '{imageSubmissionIntents}',
      COALESCE(manifest->'imageSubmissionIntents', '{}'::jsonb)
        || ${JSON.stringify({ [index]: { occurredAt: new Date().toISOString() } })}::jsonb
    ), updated_at = NOW()
    WHERE id = ${job.id}
      AND status = 'generating'
      AND claimed_at = ${job.claimedAt}
    RETURNING id
  `);
  return result.rows.length > 0;
}

async function authorizeSingleImageSafetyRetry(
  job: JobRow,
  index: number,
  retryKey: string | number,
  info: Omit<ImageSafetyRetry, "authorizedAt">,
): Promise<boolean> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(manifest, '{}'::jsonb),
          '{pendingImageRequests}',
          COALESCE(manifest->'pendingImageRequests', '{}'::jsonb) - ${String(index)}
        ),
        '{imageSafetyRetries}',
        COALESCE(manifest->'imageSafetyRetries', '{}'::jsonb)
          || ${JSON.stringify({
            [retryKey]: { ...info, authorizedAt: new Date().toISOString() },
          })}::jsonb
      ),
      '{imageSubmissionIntents}',
      COALESCE(manifest->'imageSubmissionIntents', '{}'::jsonb)
        || ${JSON.stringify({ [index]: { occurredAt: new Date().toISOString() } })}::jsonb
    ), updated_at = NOW()
    WHERE id = ${job.id}
      AND status = 'generating'
      AND claimed_at = ${job.claimedAt}
      AND NOT (COALESCE(manifest->'imageSafetyRetries', '{}'::jsonb) ? ${String(retryKey)})
    RETURNING id
  `);
  return result.rows.length > 0;
}

async function markImageSafetyRetryExhausted(
  jobId: string,
  index: number,
  retryKey: string | number,
): Promise<void> {
  const exhaustedAt = new Date().toISOString();
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(manifest, '{}'::jsonb),
            '{pendingImageRequests}',
            COALESCE(manifest->'pendingImageRequests', '{}'::jsonb) - ${String(index)}
          ),
          '{uncertainImageSubmissions}',
          COALESCE(manifest->'uncertainImageSubmissions', '{}'::jsonb) - ${String(index)}
        ),
        '{imageSubmissionIntents}',
        COALESCE(manifest->'imageSubmissionIntents', '{}'::jsonb) - ${String(index)}
      ),
      ARRAY['imageSafetyRetries', ${String(retryKey)}, 'exhaustedAt']::text[],
      ${JSON.stringify(exhaustedAt)}::jsonb,
      true
    ), updated_at = NOW()
    WHERE id = ${jobId}
      AND COALESCE(manifest->'imageSafetyRetries', '{}'::jsonb) ? ${String(retryKey)}
  `);
}

async function generateNarrativeImageWithSafetyRetry(input: {
  job: JobRow;
  index: number;
  retryKey: string | number;
  prompt: string;
  aspectRatio?: string | null;
  referenceImageUrl?: string;
  existingPollUrl?: string;
  retryAlreadyAuthorized: boolean;
}): Promise<string> {
  const retireDefinitiveAttempt = input.retryAlreadyAuthorized
    ? () => markImageSafetyRetryExhausted(input.job.id, input.index, input.retryKey)
    : () => clearImageSubmissionState(input.job.id, input.index);
  const callbacks = {
    onSubmit: (info: PendingImageRequest) =>
      persistPendingImageRequest(input.job.id, input.index, info),
    onUncertainSubmission: (info: Omit<UncertainImageSubmission, "occurredAt">) =>
      persistUncertainImageSubmission(input.job.id, input.index, info),
    onDefinitiveFailure: retireDefinitiveAttempt,
  };
  try {
    return await generateNarrativeImage({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      referenceImageUrl: input.referenceImageUrl,
      existingPollUrl: input.existingPollUrl,
      ...callbacks,
    });
  } catch (error) {
    if (!isImageModerationRejection(error)) throw error;
    if (input.retryAlreadyAuthorized) {
      // The persisted poll URL is the one and only fallback request and is now
      // definitively terminal. Retire it so callers do not misclassify it as a
      // resumable/uncertain request from stale in-memory state.
      await markImageSafetyRetryExhausted(input.job.id, input.index, input.retryKey);
      throw error;
    }
    const fallbackPrompt = stricterFamilyFriendlyImagePrompt(input.prompt);
    const authorized = await authorizeSingleImageSafetyRetry(
      input.job,
      input.index,
      input.retryKey,
      {
        reason: "The first request was rejected by an automated safety check.",
        fallbackPrompt,
      },
    );
    if (!authorized) throw error;
    try {
      return await generateNarrativeImage({
        prompt: fallbackPrompt,
        aspectRatio: input.aspectRatio,
        referenceImageUrl: input.referenceImageUrl,
        ...callbacks,
        onDefinitiveFailure: () =>
          markImageSafetyRetryExhausted(input.job.id, input.index, input.retryKey),
      });
    } catch (fallbackError) {
      if (isImageModerationRejection(fallbackError)) {
        await markImageSafetyRetryExhausted(input.job.id, input.index, input.retryKey);
      }
      throw fallbackError;
    }
  }
}

async function persistUncertainImageSubmission(
  jobId: string,
  index: number,
  info: Omit<UncertainImageSubmission, "occurredAt">,
): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
      jsonb_set(
        COALESCE(manifest, '{}'::jsonb),
        '{uncertainImageSubmissions}',
        COALESCE(manifest->'uncertainImageSubmissions', '{}'::jsonb)
          || ${JSON.stringify({ [index]: { ...info, occurredAt: new Date().toISOString() } })}::jsonb
      ),
      '{imageSubmissionIntents}',
      COALESCE(manifest->'imageSubmissionIntents', '{}'::jsonb) - ${String(index)}
    ), updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function clearImageSubmissionState(jobId: string, index: number): Promise<void> {
  const key = String(index);
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(manifest, '{}'::jsonb),
          '{pendingImageRequests}',
          COALESCE(manifest->'pendingImageRequests', '{}'::jsonb) - ${key}
        ),
        '{uncertainImageSubmissions}',
        COALESCE(manifest->'uncertainImageSubmissions', '{}'::jsonb) - ${key}
      ),
      '{imageSubmissionIntents}',
      COALESCE(manifest->'imageSubmissionIntents', '{}'::jsonb) - ${key}
    ), updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function persistImageGenerationFailure(
  jobId: string,
  index: number,
  failure: Omit<ImageGenerationFailure, "occurredAt">,
): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
      COALESCE(manifest, '{}'::jsonb),
      '{imageGenerationFailures}',
      COALESCE(manifest->'imageGenerationFailures', '{}'::jsonb)
        || ${JSON.stringify({ [index]: { ...failure, occurredAt: new Date().toISOString() } })}::jsonb
    ), updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function clearImageGenerationFailure(jobId: string, index: number): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
      COALESCE(manifest, '{}'::jsonb),
      '{imageGenerationFailures}',
      COALESCE(manifest->'imageGenerationFailures', '{}'::jsonb) - ${String(index)}
    ), updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

function imageFailureMessage(error: unknown, status: ImageGenerationFailure["status"]): string {
  if (status === "uncertain") {
    return "This image request needs attention before it can be safely retried. Choose another image or upload one.";
  }
  if (status === "pending") {
    return "This image request is still being recovered. Choose another image or upload one.";
  }
  const detail = error instanceof Error ? error.message : String(error);
  if (/content checker|content policy|safety check|request was rejected/i.test(detail)) {
    return "This scene was blocked by an automated safety check. Edit the wording or choose another image.";
  }
  return "This scene could not be created. Generate a replacement or choose another image.";
}

// Image-first jobs must finish this durable stage before any animation request.
// The immutable shot plan is the source of truth; image_assets makes retries
// idempotent even if a process stopped after upload but before manifest write.
async function prepareNarrativeImagesStage(job: JobRow): Promise<Record<string, string>> {
  if (!usesGeneratedNarrativeImages(job)) return {};
  const shots = storyboardShotsOf(job);
  if (!shots.length) throw new Error(`${IMAGE_API_FAILURE}: Image-first job has no planned visuals`);
  const stored = await db.select({ assetIndex: imageAssetsTable.assetIndex, objectPath: imageAssetsTable.objectPath })
    .from(imageAssetsTable).where(eq(imageAssetsTable.jobId, job.id));
  const liveMeta = await readAiMeta(job.id);
  const paths: Record<string, string> = { ...(liveMeta.narrativeImages ?? {}) };
  const pending = liveMeta.pendingImageRequests ?? {};
  const uncertain = liveMeta.uncertainImageSubmissions ?? {};
  const intents = liveMeta.imageSubmissionIntents ?? {};
  const failures = { ...(liveMeta.imageGenerationFailures ?? {}) };
  const safetyRetries = liveMeta.imageSafetyRetries ?? {};
  for (const asset of stored) paths[asset.assetIndex] = asset.objectPath;
  let generatedCharacterAnchorPath = selectGeneratedCharacterAnchorPath(
    stored,
    shots,
    job.referenceImagePath,
  );
  const completedImages = shots.filter((shot) => !!paths[shot.index]).length;
  const completedClips = Object.keys(liveMeta.partialClips ?? {})
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < shots.length)
    .length;
  let reportedProgress = Math.max(
    job.progressPercent ?? 0,
    5 + Math.round((completedImages / shots.length) * 23),
    completedClips > 0
      ? 30 + Math.floor((completedClips / shots.length) * 40)
      : 0,
  );
  await updateJobStatus(job.id, { status: "generating", progressPercent: reportedProgress });
  for (let position = 0; position < shots.length; position++) {
    const shot = shots[position]!;
    if (!paths[shot.index]) {
      if (safetyRetries[shot.index]?.exhaustedAt) {
        const failure = {
          status: "failed",
          message: "This scene could not be created after a safer retry. Edit the wording or choose another image.",
          occurredAt: new Date().toISOString(),
        } satisfies ImageGenerationFailure;
        await persistImageGenerationFailure(job.id, shot.index, failure);
        failures[String(shot.index)] = failure;
        logger.warn(
          { jobId: job.id, scene: shot.index },
          "Source image retry exhausted; stopping sequential image generation",
        );
        break;
      }
      const existingRequest = pending[shot.index];
      try {
        if ((uncertain[shot.index] || intents[shot.index]) && !existingRequest?.pollUrl) {
          await persistImageGenerationFailure(job.id, shot.index, {
            status: "uncertain",
            message: imageFailureMessage(null, "uncertain"),
          });
          failures[String(shot.index)] = {
            status: "uncertain",
            message: imageFailureMessage(null, "uncertain"),
            occurredAt: new Date().toISOString(),
          };
          logger.warn(
            { jobId: job.id, scene: shot.index },
            "Source image submission is uncertain; stopping sequential image generation",
          );
          break;
        }
        await assertJobOwned(job); // fence immediately before this paid image call
        const referenceImagePath = resolveCharacterReferencePath({
          usesCharacterReference: shot.usesCharacterReference === true,
          userReferenceImagePath: job.referenceImagePath,
          generatedCharacterAnchorPath,
        });
        const referenceImageUrl = referenceImagePath
          ? await storageService.getObjectEntitySignedUrl(referenceImagePath, 900)
          : undefined;
        if (!existingRequest) {
          const intentPersisted = await persistImageSubmissionIntent(job, shot.index);
          if (!intentPersisted) throw new Error(`${OWNERSHIP_LOST} (image submission intent fence)`);
        }
        const providerUrl = await generateNarrativeImageWithSafetyRetry({
          job,
          index: shot.index,
          retryKey: shot.index,
          prompt: shot.prompt,
          aspectRatio: job.aspectRatio,
          referenceImageUrl,
          existingPollUrl: existingRequest?.pollUrl,
          retryAlreadyAuthorized: !!safetyRetries[shot.index],
        });
        await assertJobOwned(job);
        const buffer = await downloadGeneratedImage(providerUrl);
        await assertJobOwned(job);
        const objectPath = await storageService.uploadNarrativeImageBuffer(buffer, job.id, shot.index);
        await db.insert(imageAssetsTable).values({
          id: randomUUID(), userId: job.userId, jobId: job.id, assetIndex: shot.index,
          objectPath, prompt: shot.prompt, style: job.style,
        }).onConflictDoNothing();
        // A concurrent retry may have won the unique insert; its row is canonical.
        const [asset] = await db.select({ objectPath: imageAssetsTable.objectPath }).from(imageAssetsTable)
          .where(and(eq(imageAssetsTable.jobId, job.id), eq(imageAssetsTable.assetIndex, shot.index))).limit(1);
        paths[shot.index] = asset?.objectPath ?? objectPath;
        await persistNarrativeImages(job.id, { [shot.index]: paths[shot.index]! });
        await clearImageSubmissionState(job.id, shot.index);
        await clearImageGenerationFailure(job.id, shot.index);
        delete failures[String(shot.index)];
        if (
          !job.referenceImagePath
          && !generatedCharacterAnchorPath
          && shot.usesCharacterReference === true
        ) {
          generatedCharacterAnchorPath = paths[shot.index];
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes(OWNERSHIP_LOST)) throw error;
        if (isTransientInfrastructureError(error)) {
          throw recoverableInfrastructureError(error);
        }
        const failureMeta = await readAiMeta(job.id);
        const status: ImageGenerationFailure["status"] =
          failureMeta.uncertainImageSubmissions?.[shot.index]
            || (
              failureMeta.imageSubmissionIntents?.[shot.index]
              && !failureMeta.pendingImageRequests?.[shot.index]?.pollUrl
            ) ? "uncertain"
            : failureMeta.pendingImageRequests?.[shot.index] ? "pending"
              : "failed";
        const failure = {
          status,
          message: imageFailureMessage(error, status),
          occurredAt: new Date().toISOString(),
        } satisfies ImageGenerationFailure;
        await persistImageGenerationFailure(job.id, shot.index, failure);
        failures[String(shot.index)] = failure;
        logger.warn(
          { err: error, jobId: job.id, scene: shot.index, status },
          "Source image failed; stopping sequential image generation",
        );
        break;
      }
    }
    const nextReportedProgress = Math.max(
      reportedProgress,
      5 + Math.round(((position + 1) / shots.length) * 23),
    );
    if (nextReportedProgress > reportedProgress) {
      reportedProgress = nextReportedProgress;
      await updateJobStatus(job.id, { progressPercent: reportedProgress });
    }
  }
  await persistNarrativeImages(job.id, paths);
  const latestMeta = await readAiMeta(job.id);
  if (!latestMeta.imageReview) {
    const latestFailures = latestMeta.imageGenerationFailures ?? failures;
    await persistInitialImageReview(job.id, shots, paths, aiMetaOf(job).selectedSceneSources, latestFailures);
  } else if (latestMeta.imageReview.phase === "approved") {
    // An approved set is immutable for the animation run. The API and worker
    // both re-read this revision before each paid video request.
    await notifyJobUpdate(job.id);
  }
  return paths;
}

async function prepareNarrativeImages(job: JobRow): Promise<Record<string, string>> {
  const photoAnimation = approvedPhotoAnimation(job);
  if (photoAnimation) return { "0": photoAnimation.sourceObjectPath };
  if (!usesGeneratedNarrativeImages(job)) return {};
  try {
    return await prepareNarrativeImagesStage(job);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (
      detail.includes(OWNERSHIP_LOST)
      || detail.includes(IMAGE_API_FAILURE)
      || detail.includes(INFRASTRUCTURE_RETRY)
    ) throw error;
    if (isTransientInfrastructureError(error)) {
      throw recoverableInfrastructureError(error);
    }
    logger.error({ err: error, jobId: job.id }, "Source-image foundation stage failed");
    throw new Error(`${IMAGE_API_FAILURE} The source-image pack could not be safely completed.`);
  }
}

async function processImageReviewReplacements(job: JobRow): Promise<void> {
  const shots = storyboardShotsOf(job);
  const shotByIndex = new Map(shots.map((shot) => [shot.index, shot]));
  const stored = await db.select({
    assetIndex: imageAssetsTable.assetIndex,
    objectPath: imageAssetsTable.objectPath,
  }).from(imageAssetsTable).where(eq(imageAssetsTable.jobId, job.id));
  let anchor = selectGeneratedCharacterAnchorPath(stored, shots, job.referenceImagePath);
  while (true) {
    const meta = await readAiMeta(job.id);
    const review = meta.imageReview;
    const pending = Object.values(review?.pendingReplacements ?? {});
    if (!review || review.phase !== "awaiting_approval" || pending.length === 0) break;
    const replacement = pending[0]!;
    if (replacement.status === "uncertain") break;
    const shot = shotByIndex.get(replacement.index);
    if (!shot) throw new Error(`${IMAGE_API_FAILURE}: Replacement scene is not in the storyboard`);
    await assertJobOwned(job);
    await db.execute(sql`
      UPDATE jobs
      SET manifest = jsonb_set(
        COALESCE(manifest, '{}'::jsonb),
        ARRAY['imageReview', 'pendingReplacements', ${replacement.id}, 'status']::text[],
        '"processing"'::jsonb
      )
      WHERE id = ${job.id}
    `);
    try {
    const submissionMeta = await readAiMeta(job.id);
    const existingRequest = submissionMeta.pendingImageRequests?.[replacement.index];
    const hasUncertainSubmission =
      !!submissionMeta.uncertainImageSubmissions?.[replacement.index]
      || (
        !!submissionMeta.imageSubmissionIntents?.[replacement.index]
        && !existingRequest?.pollUrl
      );
    if (hasUncertainSubmission) {
      await markImageReviewReplacementUncertain(
        job.id,
        replacement.id,
        replacement.index,
      );
      break;
    }
    const referencePath = resolveCharacterReferencePath({
      usesCharacterReference: shot.usesCharacterReference === true,
      userReferenceImagePath: job.referenceImagePath,
      generatedCharacterAnchorPath: anchor,
    });
    const referenceImageUrl = referencePath
      ? await storageService.getObjectEntitySignedUrl(referencePath, 900)
      : undefined;
    const replacementRetryKey = `replacement:${replacement.id}`;
    if (submissionMeta.imageSafetyRetries?.[replacementRetryKey]?.exhaustedAt) {
      throw new Error(`${IMAGE_API_FAILURE} This replacement could not be created after a safer retry.`);
    }
    if (!existingRequest) {
      const intentPersisted = await persistImageSubmissionIntent(job, replacement.index);
      if (!intentPersisted) {
        throw new Error(`${OWNERSHIP_LOST} (image replacement submission intent fence)`);
      }
    }
    const providerUrl = await generateNarrativeImageWithSafetyRetry({
      job,
      index: replacement.index,
      retryKey: replacementRetryKey,
      prompt: replacement.prompt,
      aspectRatio: job.aspectRatio,
      referenceImageUrl,
      existingPollUrl: existingRequest?.pollUrl,
      retryAlreadyAuthorized: !!submissionMeta.imageSafetyRetries?.[replacementRetryKey],
    });
    await assertJobOwned(job);
    const buffer = await downloadGeneratedImage(providerUrl);
    await assertJobOwned(job);
    const objectPath = await storageService.uploadNarrativeImageBuffer(
      buffer,
      `${job.id}-replacement-${replacement.id}`,
      replacement.index,
    );
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(jobsTable)
        .where(eq(jobsTable.id, job.id)).limit(1).for("update");
      const currentMeta = (locked?.manifest ?? {}) as AiJobMeta;
      const currentReview = currentMeta.imageReview;
      const current = currentReview?.pendingReplacements?.[replacement.id];
      const currentScene = currentReview?.scenes[String(replacement.index)];
      if (!locked || !currentReview || !current || !currentScene) return;
      const revision = currentReview.revision + 1;
      await tx.insert(imageAssetsTable).values({
        id: randomUUID(),
        userId: job.userId,
        jobId: job.id,
        assetIndex: replacement.index,
        objectPath,
        prompt: replacement.prompt,
        style: job.style,
      }).onConflictDoUpdate({
        target: [imageAssetsTable.jobId, imageAssetsTable.assetIndex],
        set: { objectPath, prompt: replacement.prompt },
      });
      const { errorMessage: _errorMessage, ...sceneWithoutError } = currentScene;
      const nextScene = {
        ...sceneWithoutError,
        canonicalPath: objectPath,
        prompt: replacement.prompt,
        revision,
        source: "regenerated" as const,
        status: "ready" as const,
        acceptedRequestId: replacement.id,
      };
      const { [replacement.id]: _accepted, ...remaining } = currentReview.pendingReplacements ?? {};
      const nextReview = {
        ...currentReview,
        revision,
        scenes: { ...currentReview.scenes, [String(replacement.index)]: nextScene },
        pendingReplacements: remaining,
      };
      await tx.update(jobsTable).set({
        manifest: sql`jsonb_set(COALESCE(${jobsTable.manifest}, '{}'::jsonb), '{imageReview}', ${JSON.stringify(nextReview)}::jsonb)`,
        updatedAt: new Date(),
      }).where(eq(jobsTable.id, job.id));
    });
    await clearImageSubmissionState(job.id, replacement.index);
    await notifyJobUpdate(job.id);
    anchor = anchor ?? objectPath;
    } catch (error) {
      if (error instanceof Error && error.message.includes(OWNERSHIP_LOST)) throw error;
      const recoveryMeta = await readAiMeta(job.id);
      const acceptedRequest = recoveryMeta.pendingImageRequests?.[replacement.index];
      const detail = error instanceof Error ? error.message : String(error);
      const definiteSubmissionRejection =
        /ai image service 4\d\d:/i.test(detail);
      const uncertainRequest =
        recoveryMeta.uncertainImageSubmissions?.[replacement.index]
        || (
          recoveryMeta.imageSubmissionIntents?.[replacement.index]
          && !acceptedRequest?.pollUrl
        );
      if (uncertainRequest && !definiteSubmissionRejection) {
        await markImageReviewReplacementUncertain(
          job.id,
          replacement.id,
          replacement.index,
        );
        logger.warn(
          { err: error, jobId: job.id, scene: replacement.index },
          "Image replacement submission is uncertain; blocked duplicate submission",
        );
        break;
      }
      const terminalAcceptedFailure =
        definiteSubmissionRejection
        || /saved source-image request was rejected|ai image generation failed|could not download generated image: http 4\d\d|generated source image was invalid/i.test(detail);
      if (acceptedRequest?.pollUrl && !terminalAcceptedFailure) {
        const nextRetry = (job.retryCount ?? 0) + 1;
        if (nextRetry >= MAX_RETRIES) {
          await markImageReviewReplacementUncertain(
            job.id,
            replacement.id,
            replacement.index,
          );
          logger.warn(
            { err: error, jobId: job.id, scene: replacement.index },
            "Image replacement recovery budget exhausted; request remains fenced",
          );
          break;
        }
        const retryAfter = Date.now() + Math.pow(2, nextRetry) * 60_000;
        const requeued = await db.execute<{ id: string }>(sql`
          UPDATE jobs SET
            status = 'queued',
            claimed_at = NULL,
            retry_count = ${nextRetry},
            error_message = 'Safely resuming the accepted replacement image request.',
            manifest = COALESCE(manifest, '{}'::jsonb) || jsonb_build_object(
              'retryAfter', ${retryAfter}::bigint
            ),
            updated_at = NOW()
          WHERE id = ${job.id}
            AND claimed_at = ${job.claimedAt}
          RETURNING id
        `);
        if (requeued.rows.length === 0) {
          await assertJobOwned(job);
          throw new Error(`${OWNERSHIP_LOST} (image replacement recovery requeue)`);
        }
        logger.warn(
          { err: error, jobId: job.id, scene: replacement.index, nextRetry, retryAfter },
          "Image replacement poll interrupted; scheduled saved-request recovery",
        );
        await notifyJobUpdate(job.id);
        return;
      }
      await clearImageSubmissionState(job.id, replacement.index);
      await refundFailedImageReviewReplacement(job.id, replacement.id);
      logger.warn({ err: error, jobId: job.id, scene: replacement.index }, "Image replacement failed; refunded replacement charge");
    }
  }
  const finalMeta = await readAiMeta(job.id);
  if (finalMeta.imageReview?.phase === "awaiting_approval") {
    const [current] = await db.select({ claimedAt: jobsTable.claimedAt })
      .from(jobsTable).where(eq(jobsTable.id, job.id)).limit(1);
    if (current?.claimedAt) {
      await updateJobStatus(job.id, { status: "pending_approval", claimedAt: null });
    }
  }
}

async function markImageReviewReplacementUncertain(
  jobId: string,
  replacementId: string,
  sceneIndex: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobsTable)
      .where(eq(jobsTable.id, jobId)).limit(1).for("update");
    const meta = (job?.manifest ?? {}) as AiJobMeta;
    const review = meta.imageReview;
    const replacement = review?.pendingReplacements?.[replacementId];
    const scene = review?.scenes[String(sceneIndex)];
    if (!job || !review || !replacement || !scene) return;
    const nextReview = {
      ...review,
      scenes: {
        ...review.scenes,
        [String(sceneIndex)]: {
          ...scene,
          status: "uncertain" as const,
          errorMessage: "The replacement request is still being verified. Another request will not be submitted.",
        },
      },
      pendingReplacements: {
        ...review.pendingReplacements,
        [replacementId]: { ...replacement, status: "uncertain" as const },
      },
    };
    await tx.update(jobsTable).set({
      status: "pending_approval",
      claimedAt: null,
      manifest: sql`jsonb_set(COALESCE(${jobsTable.manifest}, '{}'::jsonb), '{imageReview}', ${JSON.stringify(nextReview)}::jsonb)`,
      updatedAt: new Date(),
    }).where(eq(jobsTable.id, jobId));
  });
}

async function refundFailedImageReviewReplacement(jobId: string, replacementId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1).for("update");
    const meta = (job?.manifest ?? {}) as AiJobMeta;
    const review = meta.imageReview;
    const replacement = review?.pendingReplacements?.[replacementId];
    if (!replacement) return;
    await tx.update(creditsTable).set({
      subscriptionCredits: sql`${creditsTable.subscriptionCredits} + ${replacement.subscriptionCredits}`,
      topupCredits: sql`${creditsTable.topupCredits} + ${replacement.topupCredits}`,
      creditsRemaining: sql`${creditsTable.creditsRemaining} + ${replacement.credits}`,
      creditsUsed: sql`GREATEST(${creditsTable.creditsUsed} - ${replacement.credits}, 0)`,
      updatedAt: new Date(),
    }).where(eq(creditsTable.userId, job!.userId));
    const { [replacementId]: _failed, ...remaining } = review!.pendingReplacements ?? {};
    const failedScene = review!.scenes[String(replacement.index)];
    const nextReview = {
      ...review,
      scenes: failedScene
        ? {
            ...review!.scenes,
            [String(replacement.index)]: {
              ...failedScene,
              status: "failed" as const,
              errorMessage: "The replacement image could not be generated. Try again or choose another image.",
            },
          }
        : review!.scenes,
      pendingReplacements: remaining,
    };
    await tx.update(jobsTable).set({
      manifest: sql`jsonb_set(COALESCE(${jobsTable.manifest}, '{}'::jsonb), '{imageReview}', ${JSON.stringify(nextReview)}::jsonb)`,
      updatedAt: new Date(),
    }).where(eq(jobsTable.id, jobId));
  });
}

type ImagePackMeta = AiJobMeta & {
  imagePack?: { imageCount?: number; scenes?: PersistedStoryboardShot[] };
  imagePackRefunded?: boolean;
  imagePackChargedCredits?: number;
};

async function refundImagePackRemainder(job: JobRow): Promise<number> {
  return db.transaction(async (tx) => {
    const [stored] = await tx
      .select({ manifest: jobsTable.manifest })
      .from(jobsTable)
      .where(eq(jobsTable.id, job.id))
      .limit(1)
      .for("update");
    const meta = (stored?.manifest ?? {}) as ImagePackMeta;
    if (meta.imagePackRefunded) return 0;
    const totalImages = meta.imagePack?.imageCount ?? 0;
    const reserved = Math.max(0, meta.reservedCredits ?? 0);
    const [completed] = await tx
      .select({ count: count() })
      .from(imageAssetsTable)
      // Deleting a library asset must not make an already-created image
      // refundable. Billing follows persisted provider output, not visibility.
      .where(eq(imageAssetsTable.jobId, job.id));
    const charged = Math.min(
      reserved,
      Math.min(totalImages, Number(completed?.count ?? 0)) * GENERATED_IMAGE_CREDITS_PER_VISUAL,
    );
    const originalSubscription = Math.max(0, meta.reservedSubscriptionCredits ?? 0);
    const originalTopUp = Math.max(0, meta.reservedTopupCredits ?? 0);
    const subscriptionRefund = Math.max(0, originalSubscription - Math.min(charged, originalSubscription));
    const topUpRefund = Math.max(
      0,
      originalTopUp - Math.max(0, charged - originalSubscription),
    );
    const refund = subscriptionRefund + topUpRefund;
    if (refund > 0) {
      await tx
        .update(creditsTable)
        .set({
          subscriptionCredits: sql`subscription_credits + ${subscriptionRefund}`,
          topupCredits: sql`topup_credits + ${topUpRefund}`,
          creditsRemaining: sql`credits_remaining + ${refund}`,
          creditsUsed: sql`GREATEST(credits_used - ${refund}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(creditsTable.userId, job.userId));
    }
    await tx
      .update(jobsTable)
      .set({
        manifest: {
          ...meta,
          imagePackRefunded: true,
          imagePackChargedCredits: charged,
        } as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(jobsTable.id, job.id));
    return refund;
  });
}

async function processImagePackJob(job: JobRow): Promise<void> {
  const meta = aiMetaOf(job) as ImagePackMeta;
  const imageCount = meta.imagePack?.imageCount ?? 0;
  if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 30) {
    await refundImagePackRemainder(job);
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: "This image pack has an invalid image count. Any reservation was returned.",
    });
    void notifyAdminRenderFailed(job, "Image pack has an invalid image count.");
    return;
  }
  try {
    const imageAspectRatio = job.aspectRatio === "16:9" ? "16:9" : "9:16";
    const scenes = Array.isArray(meta.imagePack?.scenes) ? meta.imagePack.scenes : [];
    const sceneByIndex = new Map(scenes.map((scene) => [scene.index, scene]));
    const existing = await db
      .select({
        assetIndex: imageAssetsTable.assetIndex,
        objectPath: imageAssetsTable.objectPath,
      })
      .from(imageAssetsTable)
      .where(and(eq(imageAssetsTable.jobId, job.id), isNull(imageAssetsTable.deletedAt)));
    const completed = new Set(existing.map((asset) => asset.assetIndex));
    let reportedProgress = Math.max(
      job.progressPercent ?? 0,
      5 + Math.round((completed.size / imageCount) * 90),
    );
    await updateJobStatus(job.id, { status: "generating", progressPercent: reportedProgress });
    const liveMeta = await readAiMeta(job.id);
    const pending = liveMeta.pendingImageRequests ?? {};
    const uncertain = liveMeta.uncertainImageSubmissions ?? {};
    const intents = liveMeta.imageSubmissionIntents ?? {};
    const safetyRetries = liveMeta.imageSafetyRetries ?? {};
    let generatedCharacterAnchorPath = selectGeneratedCharacterAnchorPath(
      existing,
      scenes,
      job.referenceImagePath,
    );
    for (let index = 0; index < imageCount; index++) {
      if (completed.has(index)) {
        if (pending[index] || uncertain[index]) {
          await clearImageSubmissionState(job.id, index);
        }
        continue;
      }
      await assertJobOwned(job);
      const scene = sceneByIndex.get(index);
      const existingRequest = pending[index];
      if (safetyRetries[index]?.exhaustedAt) {
        throw new Error(`${IMAGE_API_FAILURE} Scene ${index + 1} could not be created after a safer retry.`);
      }
      if ((uncertain[index] || intents[index]) && !existingRequest?.pollUrl) {
        throw new Error(`${IMAGE_API_FAILURE} An image request has an uncertain submission state.`);
      }
      const prompt = scene
        ? [
            `${imageAspectRatio === "16:9" ? "landscape 16:9" : "portrait 9:16"} editorial still`,
            scene.prompt,
          ].join(", ")
        : [
            `${imageAspectRatio === "16:9" ? "landscape 16:9" : "portrait 9:16"} editorial still`,
            job.style ? `${job.style} visual style` : "cinematic visual style",
            job.prompt?.trim() ?? "",
          ].filter(Boolean).join(", ");
      const shouldUseReference = scene
        ? scene.usesCharacterReference === true
        : Boolean(job.referenceImagePath);
      const referenceImagePath = resolveCharacterReferencePath({
        usesCharacterReference: shouldUseReference,
        userReferenceImagePath: job.referenceImagePath,
        generatedCharacterAnchorPath,
      });
      const referenceImageUrl = referenceImagePath
        ? await storageService.getObjectEntitySignedUrl(referenceImagePath, 900)
        : undefined;
      if (!existingRequest) {
        const intentPersisted = await persistImageSubmissionIntent(job, index);
        if (!intentPersisted) throw new Error(`${OWNERSHIP_LOST} (image submission intent fence)`);
      }
      const providerUrl = await generateNarrativeImageWithSafetyRetry({
        job,
        index,
        retryKey: index,
        prompt,
        aspectRatio: imageAspectRatio,
        referenceImageUrl,
        existingPollUrl: existingRequest?.pollUrl,
        retryAlreadyAuthorized: !!safetyRetries[index],
      });
      await assertJobOwned(job);
      const buffer = await downloadGeneratedImage(providerUrl);
      await assertJobOwned(job);
      const objectPath = await storageService.uploadImagePackBuffer(buffer, job.id, index);
      await db.insert(imageAssetsTable).values({
        id: randomUUID(),
        userId: job.userId,
        jobId: job.id,
        assetIndex: index,
        objectPath,
        prompt,
        style: job.style,
      }).onConflictDoNothing();
      const [asset] = await db.select({ objectPath: imageAssetsTable.objectPath }).from(imageAssetsTable)
        .where(and(eq(imageAssetsTable.jobId, job.id), eq(imageAssetsTable.assetIndex, index))).limit(1);
      const canonicalObjectPath = asset?.objectPath ?? objectPath;
      await clearImageSubmissionState(job.id, index);
      if (
        !job.referenceImagePath
        && !generatedCharacterAnchorPath
        && scene?.usesCharacterReference === true
      ) {
        generatedCharacterAnchorPath = canonicalObjectPath;
      }
      reportedProgress = Math.max(
        reportedProgress,
        Math.min(95, 5 + Math.round(((index + 1) / imageCount) * 90)),
      );
      await updateJobStatus(job.id, { progressPercent: reportedProgress });
    }
    await updateJobStatus(job.id, { status: "ready", progressPercent: 100 });
    await notifyJobUpdate(job.id);
    logger.info({ jobId: job.id, imageCount }, "Image pack completed");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (detail.includes(IMAGE_POLL_TIMEOUT)) {
      const liveMeta = await readAiMeta(job.id);
      const hasPersistedRequest = Object.keys(liveMeta.pendingImageRequests ?? {}).length > 0;
      const pollRecovery = planNoChargePollRecovery(liveMeta, true);
      if (hasPersistedRequest && pollRecovery.canRetry) {
        const delayMs = Math.min(Math.pow(2, pollRecovery.nextCount) * 60_000, 5 * 60_000);
        const requeued = await requeueSavedPollAtNoCharge(
          job.id,
          job.claimedAt,
          "image",
          `Image polling timed out. Safely resuming the saved request at no charge (${pollRecovery.nextCount}/${MAX_NO_CHARGE_POLL_RECOVERIES}).`,
          Date.now() + delayMs,
        );
        if (requeued) {
          await notifyJobUpdate(job.id);
          logger.info(
            { jobId: job.id, nextRecoveryCount: requeued.recovery_count },
            "Image pack polling timeout safely requeued",
          );
          return;
        }
      }
    }
    const terminal = await db.execute<{ id: string }>(sql`
      UPDATE jobs SET
        status = 'failed', claimed_at = NULL,
        error_message = 'Image generation could not finish.',
        updated_at = NOW()
      WHERE id = ${job.id}
        AND status = 'generating'
        AND claimed_at = ${job.claimedAt}
      RETURNING id
    `);
    if (terminal.rows.length === 0) {
      logger.info({ jobId: job.id }, "Image pack failure ignored because this run no longer owns the job");
      return;
    }
    const refunded = await refundImagePackRemainder(job);
    const cleanDetail = detail
      .replace(IMAGE_API_FAILURE, "")
      .replace(IMAGE_POLL_TIMEOUT, "")
      .trim();
    await updateJobStatus(job.id, {
      errorMessage: `${cleanDetail || "Image generation could not finish."} ${refunded > 0 ? "Credits for images that were not created were returned." : ""}`.trim(),
    });
    logger.error({ err, jobId: job.id, refunded }, "Image pack failed");
    void notifyAdminRenderFailed(job, cleanDetail || "Image pack generation failed.");
  }
}

function storyboardShotsOf(job: JobRow): PersistedStoryboardShot[] {
  const shots = aiMetaOf(job).storyboard?.shots;
  if (!Array.isArray(shots)) return [];
  return shots
    .filter((value): value is PersistedStoryboardShot => {
      if (!value || typeof value !== "object") return false;
      const shot = value as Record<string, unknown>;
      return (
        Number.isFinite(shot.index) &&
        typeof shot.label === "string" &&
        Number.isFinite(shot.startTime) &&
        Number.isFinite(shot.energy) &&
        typeof shot.prompt === "string" &&
        shot.prompt.trim().length > 0
      );
    })
    .sort((a, b) => a.index - b.index);
}

function isStrictUniqueSourcesJob(job: JobRow): boolean {
  return aiMetaOf(job).strictUniqueSourcesVersion === 1;
}

async function validateStrictSourceFoundation(
  job: JobRow,
  expectedSegments: number,
  clipDurationSec: number,
  totalDuration: number,
  preparedImages: Record<string, string>,
): Promise<void> {
  if (!isStrictUniqueSourcesJob(job)) return;
  const meta = aiMetaOf(job);
  const shots = storyboardShotsOf(job);
  if (
    !Array.isArray(meta.storyboard?.shots)
    || meta.storyboard.shots.length !== expectedSegments
    || meta.storyboard.numClips !== expectedSegments
    || shots.length !== expectedSegments
    || shots.some((shot, index) => shot.index !== index)
  ) {
    throw new Error(`${PROVIDER_API_FAILURE}: Strict job storyboard must contain every indexed segment exactly once`);
  }
  // This also rejects duplicated, reordered, or incomplete timeline identities
  // before a provider POST can be reached.
  resolveStrictMontageSequence(
    meta.storyboard?.timeline,
    shots.map((shot) => ({ visualIndex: shot.index })),
    totalDuration,
    clipDurationSec,
  );
  const paths = shots.map((shot) => preparedImages[shot.index]);
  if (
    paths.some((path) => typeof path !== "string" || path.trim().length === 0)
    || new Set(paths).size !== paths.length
  ) {
    throw new Error(`${IMAGE_API_FAILURE}: Strict job requires one distinct prepared image for every segment`);
  }
  const stored = await db.select({
    assetIndex: imageAssetsTable.assetIndex,
    objectPath: imageAssetsTable.objectPath,
  }).from(imageAssetsTable).where(eq(imageAssetsTable.jobId, job.id));
  const persistedByIndex = new Map(stored.map((asset) => [asset.assetIndex, asset.objectPath]));
  if (shots.some((shot) => persistedByIndex.get(shot.index) !== preparedImages[shot.index])) {
    throw new Error(`${IMAGE_API_FAILURE}: Strict job prepared images are not durably persisted for every segment`);
  }
  const fingerprints = [];
  for (const shot of shots) {
    const path = preparedImages[shot.index];
    try {
      const buffer = await storageService.downloadObjectBuffer(path!);
      fingerprints.push(await perceptualFingerprint(buffer, "image"));
    } catch (error) {
      if (isTransientInfrastructureError(error)) {
        throw recoverableInfrastructureError(error);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${IMAGE_API_FAILURE}: Strict source image inspection failed at scene ${shot.index + 1}: ${detail}`,
      );
    }
  }
  try {
    assertStrictUniqueMedia(true, fingerprints, "source image");
  } catch (error) {
    throw new Error(`${IMAGE_API_FAILURE}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readAiMeta(jobId: string): Promise<AiJobMeta> {
  const [row] = await db
    .select({ manifest: jobsTable.manifest })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  return row?.manifest && typeof row.manifest === "object" ? (row.manifest as AiJobMeta) : {};
}

async function requeueSavedPollAtNoCharge(
  jobId: string,
  claimedAt: Date | string | null,
  kind: "provider" | "image",
  message: string,
  retryAfter: number,
): Promise<{ id: string; recovery_count: number } | null> {
  if (!claimedAt) return null;
  const countKey = kind === "image" ? "imagePollRecoveryCount" : "providerPollRecoveryCount";
  const validPendingRequest = kind === "image"
    ? sql`EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(manifest->'pendingImageRequests', '{}'::jsonb)) AS pending(scene, request)
      ) AND NOT EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(manifest->'pendingImageRequests', '{}'::jsonb)) AS pending(scene, request)
        WHERE NOT (
          jsonb_typeof(request) = 'object'
          AND btrim(COALESCE(request->>'pollUrl', '')) ~ '^https://'
        )
      )`
    : sql`EXISTS (
        SELECT 1
        FROM jsonb_each_text(COALESCE(manifest->'pendingRequests', '{}'::jsonb)) AS pending(scene, poll_url)
      ) AND NOT EXISTS (
        SELECT 1
        FROM jsonb_each_text(COALESCE(manifest->'pendingRequests', '{}'::jsonb)) AS pending(scene, poll_url)
        WHERE NOT (btrim(poll_url) ~ '^https://')
      )`;
  const priorCount = sql`CASE
    WHEN manifest->>${countKey} IS NULL THEN 0
    WHEN manifest->>${countKey} ~ '^[0-9]{1,8}$'
      THEN (manifest->>${countKey})::int
    ELSE ${MAX_NO_CHARGE_POLL_RECOVERIES}
  END`;
  const result = await db.execute<{ id: string; recovery_count: number }>(sql`
    UPDATE jobs
    SET status = 'queued',
        claimed_at = NULL,
        error_message = ${message},
        manifest = jsonb_set(
          COALESCE(manifest, '{}'::jsonb) || jsonb_build_object(
            'retryAfter', ${retryAfter}::bigint,
            'finalizeWithPartial', false
          ),
          ARRAY[${countKey}]::text[],
          to_jsonb((${priorCount}) + 1),
          true
        ),
        updated_at = NOW()
    WHERE id = ${jobId}
      AND status IN ('analyzing', 'generating', 'stitching')
      AND claimed_at = ${claimedAt}
      AND (${priorCount}) < ${MAX_NO_CHARGE_POLL_RECOVERIES}
      AND ${validPendingRequest}
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(COALESCE(manifest->'submissionIntents', '{}'::jsonb))
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(COALESCE(manifest->'uncertainSubmissions', '{}'::jsonb))
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(COALESCE(manifest->'rejectedRequests', '{}'::jsonb))
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(COALESCE(manifest->'imageSubmissionIntents', '{}'::jsonb))
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(COALESCE(manifest->'uncertainImageSubmissions', '{}'::jsonb))
      )
    RETURNING id, (manifest->>${countKey})::int AS recovery_count
  `);
  return result.rows[0] ?? null;
}

async function writeAiMeta(jobId: string, meta: AiJobMeta): Promise<void> {
  await db
    .update(jobsTable)
    .set({ manifest: meta as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(jobsTable.id, jobId));
}

// Atomic jsonb merge: records the clip under manifest.partialClips and drops
// its pendingRequests entry in one UPDATE, so concurrent manifest writers
// (admin attach-clips, retry scheduling) never lose keys to a stale
// read-modify-write.
async function persistPartialClip(jobId: string, index: number, objectPath: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          jsonb_set(
            COALESCE(manifest, '{}'::jsonb),
            '{partialClips}',
            COALESCE(manifest->'partialClips', '{}'::jsonb) || ${JSON.stringify({ [index]: objectPath })}::jsonb
          ),
          '{pendingRequests}',
          COALESCE(manifest->'pendingRequests', '{}'::jsonb) - ${String(index)}
        ),
        updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function persistTargetedSceneClip(
  job: JobRow,
  index: number,
  objectPath: string,
  markerRequestedAt: string,
): Promise<void> {
  const result = await db.execute(sql`
    UPDATE jobs
    SET manifest = (
          jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE(manifest, '{}'::jsonb),
                '{partialClips}',
                COALESCE(manifest->'partialClips', '{}'::jsonb)
                  || ${JSON.stringify({ [index]: objectPath })}::jsonb
              ),
              '{pendingRequests}',
              COALESCE(manifest->'pendingRequests', '{}'::jsonb) - ${String(index)}
            ),
            '{rejectedRequests}',
            COALESCE(manifest->'rejectedRequests', '{}'::jsonb) - ${String(index)}
          ) - 'targetedSceneRecovery'
        ),
        updated_at = NOW()
    WHERE id = ${job.id}
      AND status = 'generating'
      AND claimed_at = ${job.claimedAt}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'sceneIndex', '') = ${String(index)}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'requestedAt', '') = ${markerRequestedAt}
    RETURNING id
  `);
  if (result.rows.length === 0) {
    await assertJobOwned(job);
    throw new Error(`${PROVIDER_API_FAILURE}: Targeted scene recovery marker changed before fallback persistence`);
  }
}

async function persistTargetedRejectedRequest(
  job: JobRow,
  index: number,
  pollUrl: string,
  reason: string,
  markerRequestedAt: string,
): Promise<void> {
  const entry: RejectedClipRequest = {
    pollUrl,
    reason: reason.slice(0, 240),
    occurredAt: new Date().toISOString(),
  };
  const result = await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          jsonb_set(
            COALESCE(manifest, '{}'::jsonb),
            '{rejectedRequests}',
            COALESCE(manifest->'rejectedRequests', '{}'::jsonb)
              || ${JSON.stringify({ [index]: entry })}::jsonb
          ),
          '{pendingRequests}',
          COALESCE(manifest->'pendingRequests', '{}'::jsonb) - ${String(index)}
        ),
        updated_at = NOW()
    WHERE id = ${job.id}
      AND status = 'generating'
      AND claimed_at = ${job.claimedAt}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'sceneIndex', '') = ${String(index)}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'requestedAt', '') = ${markerRequestedAt}
    RETURNING id
  `);
  if (result.rows.length === 0) {
    await assertJobOwned(job);
    throw new Error(`${PROVIDER_API_FAILURE}: Targeted scene recovery marker changed before terminal archiving`);
  }
}

// Record the provider request for a clip the moment it is accepted, so a clip
// that finishes after we stop polling (crash/freeze/deploy) can be fetched on
// the next attempt instead of being regenerated (and paid for) again.
// Atomic jsonb merge — see persistPartialClip.
async function persistPendingRequest(jobId: string, index: number, pollUrl: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(manifest, '{}'::jsonb),
              '{pendingRequests}',
              COALESCE(manifest->'pendingRequests', '{}'::jsonb) || ${JSON.stringify({ [index]: pollUrl })}::jsonb
            ),
            '{uncertainSubmissions}',
            COALESCE(manifest->'uncertainSubmissions', '{}'::jsonb) - ${String(index)}
          ),
          '{submissionIntents}',
          COALESCE(manifest->'submissionIntents', '{}'::jsonb) - ${String(index)}
        ),
        updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function persistTargetedPendingRequest(
  job: JobRow,
  index: number,
  pollUrl: string,
  markerRequestedAt: string,
): Promise<void> {
  const result = await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(manifest, '{}'::jsonb),
              '{pendingRequests}',
              COALESCE(manifest->'pendingRequests', '{}'::jsonb)
                || ${JSON.stringify({ [index]: pollUrl })}::jsonb
            ),
            '{uncertainSubmissions}',
            COALESCE(manifest->'uncertainSubmissions', '{}'::jsonb) - ${String(index)}
          ),
          '{submissionIntents}',
          COALESCE(manifest->'submissionIntents', '{}'::jsonb) - ${String(index)}
        ),
        updated_at = NOW()
    WHERE id = ${job.id}
      AND status = 'generating'
      AND claimed_at = ${job.claimedAt}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'sceneIndex', '') = ${String(index)}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'requestedAt', '') = ${markerRequestedAt}
    RETURNING id
  `);
  if (result.rows.length === 0) {
    await assertJobOwned(job);
    throw new Error(`${PROVIDER_API_FAILURE}: Targeted scene recovery marker changed before request acceptance`);
  }
}

async function persistClipSubmissionIntent(
  job: JobRow,
  index: number,
  provider: string,
): Promise<boolean> {
  const entry: ClipSubmissionIntent = {
    provider: provider.slice(0, 40),
    occurredAt: new Date().toISOString(),
  };
  const result = await db.execute<{ id: string }>(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          COALESCE(manifest, '{}'::jsonb),
          '{submissionIntents}',
          COALESCE(manifest->'submissionIntents', '{}'::jsonb)
            || ${JSON.stringify({ [index]: entry })}::jsonb
        ),
        updated_at = NOW()
    WHERE id = ${job.id}
      AND status = 'generating'
      AND claimed_at = ${job.claimedAt}
    RETURNING id
  `);
  return result.rows.length > 0;
}

async function clearUnsubmittedClipIntent(job: JobRow, index: number): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          COALESCE(manifest, '{}'::jsonb),
          '{submissionIntents}',
          COALESCE(manifest->'submissionIntents', '{}'::jsonb) - ${String(index)}
        ),
        updated_at = NOW()
    WHERE id = ${job.id}
      AND status = 'generating'
      AND claimed_at = ${job.claimedAt}
  `);
}

async function persistTargetedClipSubmissionIntent(
  job: JobRow,
  index: number,
  provider: string,
  markerRequestedAt: string,
): Promise<boolean> {
  const entry: ClipSubmissionIntent = {
    provider: provider.slice(0, 40),
    occurredAt: new Date().toISOString(),
  };
  const result = await db.execute<{ id: string }>(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          COALESCE(manifest, '{}'::jsonb),
          '{submissionIntents}',
          COALESCE(manifest->'submissionIntents', '{}'::jsonb)
            || ${JSON.stringify({ [index]: entry })}::jsonb
        ),
        updated_at = NOW()
    WHERE id = ${job.id}
      AND status = 'generating'
      AND claimed_at = ${job.claimedAt}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'sceneIndex', '') = ${String(index)}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'requestedAt', '') = ${markerRequestedAt}
    RETURNING id
  `);
  return result.rows.length > 0;
}

async function persistTargetedFallbackIntent(
  job: JobRow,
  index: number,
  provider: string,
  markerRequestedAt: string,
): Promise<void> {
  const entry: ClipSubmissionIntent = {
    provider: provider.slice(0, 40),
    occurredAt: new Date().toISOString(),
  };
  const result = await db.execute<{ id: string }>(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(manifest, '{}'::jsonb),
              '{submissionIntents}',
              COALESCE(manifest->'submissionIntents', '{}'::jsonb)
                || ${JSON.stringify({ [index]: entry })}::jsonb
            ),
            '{pendingRequests}',
            COALESCE(manifest->'pendingRequests', '{}'::jsonb) - ${String(index)}
          ),
          '{rejectedRequests}',
          COALESCE(manifest->'rejectedRequests', '{}'::jsonb) - ${String(index)}
        ),
        updated_at = NOW()
    WHERE id = ${job.id}
      AND status = 'generating'
      AND claimed_at = ${job.claimedAt}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'sceneIndex', '') = ${String(index)}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'requestedAt', '') = ${markerRequestedAt}
    RETURNING id
  `);
  if (result.rows.length === 0) {
    await assertJobOwned(job);
    throw new Error(`${PROVIDER_API_FAILURE}: Targeted scene recovery marker changed before fallback submission`);
  }
}

async function persistUncertainSubmission(
  jobId: string,
  index: number,
  info: Omit<UncertainSubmission, "occurredAt">,
): Promise<void> {
  const entry: UncertainSubmission = {
    provider: info.provider.slice(0, 40),
    status: info.status,
    activityId: info.activityId?.slice(0, 120),
    reason: info.reason.slice(0, 240),
    occurredAt: new Date().toISOString(),
  };
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          jsonb_set(
            COALESCE(manifest, '{}'::jsonb),
            '{uncertainSubmissions}',
            COALESCE(manifest->'uncertainSubmissions', '{}'::jsonb) || ${JSON.stringify({ [index]: entry })}::jsonb
          ),
          '{submissionIntents}',
          COALESCE(manifest->'submissionIntents', '{}'::jsonb) - ${String(index)}
        ),
        updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function persistTargetedUncertainSubmission(
  job: JobRow,
  index: number,
  info: Omit<UncertainSubmission, "occurredAt">,
  markerRequestedAt: string,
): Promise<void> {
  const entry: UncertainSubmission = {
    provider: info.provider.slice(0, 40),
    status: info.status,
    activityId: info.activityId?.slice(0, 120),
    reason: info.reason.slice(0, 240),
    occurredAt: new Date().toISOString(),
  };
  const result = await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          jsonb_set(
            COALESCE(manifest, '{}'::jsonb),
            '{uncertainSubmissions}',
            COALESCE(manifest->'uncertainSubmissions', '{}'::jsonb)
              || ${JSON.stringify({ [index]: entry })}::jsonb
          ),
          '{submissionIntents}',
          COALESCE(manifest->'submissionIntents', '{}'::jsonb) - ${String(index)}
        ),
        updated_at = NOW()
    WHERE id = ${job.id}
      AND status = 'generating'
      AND claimed_at = ${job.claimedAt}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'sceneIndex', '') = ${String(index)}
      AND COALESCE(manifest->'targetedSceneRecovery'->>'requestedAt', '') = ${markerRequestedAt}
    RETURNING id
  `);
  if (result.rows.length === 0) {
    await assertJobOwned(job);
    throw new Error(`${PROVIDER_API_FAILURE}: Targeted scene recovery marker changed during uncertain submission`);
  }
}

// Durably drop a pendingRequests entry that turned out to be dead (expired,
// failed, or unusable) so future attempts don't re-check it.
async function clearPendingRequest(jobId: string, index: number): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          COALESCE(manifest, '{}'::jsonb),
          '{pendingRequests}',
          COALESCE(manifest->'pendingRequests', '{}'::jsonb) - ${String(index)}
        ),
        updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function persistRejectedRequest(
  jobId: string,
  index: number,
  pollUrl: string,
  reason: string,
): Promise<void> {
  const entry: RejectedClipRequest = {
    pollUrl,
    reason: reason.slice(0, 240),
    occurredAt: new Date().toISOString(),
  };
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          jsonb_set(
            COALESCE(manifest, '{}'::jsonb),
            '{rejectedRequests}',
            COALESCE(manifest->'rejectedRequests', '{}'::jsonb)
              || ${JSON.stringify({ [index]: entry })}::jsonb
          ),
          '{pendingRequests}',
          COALESCE(manifest->'pendingRequests', '{}'::jsonb) - ${String(index)}
        ),
        updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function persistLipSyncPollUrl(jobId: string, pollUrl: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          COALESCE(manifest, '{}'::jsonb),
          '{lipSyncPollUrl}',
          to_jsonb(${pollUrl}::text)
        ),
        updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

async function refundReservation(jobId: string, userId: string, reason: string): Promise<void> {
  const imageFirstSettlement = await settleImageFirstReservation(jobId, userId);
  if (imageFirstSettlement.handled) {
    if (imageFirstSettlement.refundedCredits > 0) {
      logger.info({
        jobId,
        userId,
        refunded: imageFirstSettlement.refundedCredits,
        charged: imageFirstSettlement.chargedCredits,
        completedImages: imageFirstSettlement.completedImages,
        spentVideoScenes: imageFirstSettlement.spentVideoScenes,
        reason,
      }, "Settled image-first reservation");
    }
    return;
  }
  const totalRefund = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ manifest: jobsTable.manifest })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1)
      .for("update");
    const meta =
      row?.manifest && typeof row.manifest === "object" ? (row.manifest as AiJobMeta) : {};
    const reserved = meta.reservedCredits ?? 0;
    if (reserved <= 0 || meta.refunded) return 0;
    const hasExactSplit =
      typeof meta.reservedSubscriptionCredits === "number" ||
      typeof meta.reservedTopupCredits === "number";
    const subscriptionRefund = hasExactSplit ? Math.max(0, meta.reservedSubscriptionCredits ?? 0) : reserved;
    const topupRefund = hasExactSplit ? Math.max(0, meta.reservedTopupCredits ?? 0) : 0;
    const total = subscriptionRefund + topupRefund;
    await tx
      .update(creditsTable)
      .set({
        subscriptionCredits: sql`subscription_credits + ${subscriptionRefund}`,
        topupCredits: sql`topup_credits + ${topupRefund}`,
        creditsRemaining: sql`credits_remaining + ${total}`,
        creditsUsed: sql`GREATEST(credits_used - ${total}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(creditsTable.userId, userId));
    await tx
      .update(jobsTable)
      .set({ manifest: { ...meta, refunded: true } as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(jobsTable.id, jobId));
    if (meta.bundledLipSyncChildId && !meta.bundledLipSyncActivated) {
      await tx
        .update(jobsTable)
        .set({
          status: "failed",
          errorMessage: "The source video could not be created, so bundled AI Lip Sync was not started.",
          updatedAt: new Date(),
        })
        .where(eq(jobsTable.id, meta.bundledLipSyncChildId));
    }
    return total;
  });
  if (totalRefund > 0) {
    logger.info({ jobId, userId, reserved: totalRefund, reason }, "Refunded reserved credits");
  }
}

async function cleanupPartialClips(jobId: string): Promise<void> {
  const meta = await readAiMeta(jobId);
  const paths = Object.values(meta.partialClips ?? {});
  if (paths.length) {
    await Promise.all(paths.map((p) => storageService.deleteObject(p).catch(() => {})));
  }
  if (
    (meta.partialClips && Object.keys(meta.partialClips).length) ||
    (meta.pendingRequests && Object.keys(meta.pendingRequests).length) ||
    meta.finalizeWithPartial
  ) {
    // Also drop the one-shot finalize flag so a later requeue/retry of this job
    // runs normally instead of silently staying in finalize-only mode.
    const { finalizeWithPartial: _drop, ...rest } = meta;
    await writeAiMeta(jobId, { ...rest, partialClips: {}, pendingRequests: {} });
  }
}

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
    SET status = 'analyzing',
        claimed_at = date_trunc('milliseconds', NOW()),
        updated_at = NOW()
    WHERE id = (
      SELECT j.id FROM jobs j
      WHERE j.status = 'queued' AND j.retry_count < ${MAX_RETRIES}
        AND (
          j.manifest->>'retryAfter' IS NULL
          OR NOT (j.manifest->>'retryAfter') ~ '^[0-9]+$'
          OR (j.manifest->>'retryAfter')::bigint <= ${Date.now()}
        )
        -- One job per user at a time: don't start another of this user's jobs
        -- while one is still actively processing (fresh heartbeat within 20
        -- min — stale/stuck rows don't block, the watchdog handles those).
        -- This lets the furthest-along render finish and charge its credits
        -- before the user's next job starts spending.
        AND NOT EXISTS (
          SELECT 1 FROM jobs o
          WHERE o.user_id = j.user_id AND o.id <> j.id
            AND o.status IN ('analyzing', 'generating', 'stitching')
            AND o.updated_at > NOW() - INTERVAL '20 minutes'
        )
      -- Priority: the job with the most already-rendered (paid-for) clips goes
      -- first — closest to a finished video — then oldest first.
      ORDER BY
        (SELECT count(*) FROM jsonb_object_keys(COALESCE(j.manifest->'partialClips', '{}'::jsonb))) DESC,
        j.created_at ASC
      LIMIT 1
      FOR UPDATE OF j SKIP LOCKED
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

async function releaseUnstartedClaim(job: JobRow): Promise<void> {
  if (!job.claimedAt) return;
  const released = await db
    .update(jobsTable)
    .set({
      status: "queued",
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobsTable.id, job.id),
        eq(jobsTable.status, "analyzing"),
        eq(jobsTable.claimedAt, new Date(job.claimedAt)),
      ),
    )
    .returning({ id: jobsTable.id });
  if (released.length > 0) {
    logger.info(
      { jobId: job.id, workerId: WORKER_ID },
      "Released newly claimed job during worker shutdown",
    );
    await notifyJobUpdate(job.id);
  }
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
function startJobHeartbeat(job: JobRow): () => void {
  const jobId = job.id;
  const claimToken = job.claimedAt;
  let stopped = false;
  const beat = async () => {
    if (stopped) return;
    for (let attempt = 1; attempt <= HEARTBEAT_RETRIES; attempt++) {
      try {
        const result = await db.execute<{ id: string }>(sql`
          UPDATE jobs SET updated_at = NOW()
          WHERE id = ${jobId}
            AND claimed_at = ${claimToken}
            AND status IN ('analyzing', 'generating', 'stitching')
          RETURNING id
        `);
        if (result.rows.length === 0) {
          stopped = true;
          logger.info({ jobId }, "Job heartbeat stopped after ownership changed");
        }
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

async function assertApprovedImageReview(job: JobRow): Promise<void> {
  if (!usesGeneratedNarrativeImages(job)) return;
  const meta = await readAiMeta(job.id);
  const review = meta.imageReview;
  if (!review || review.phase !== "approved" || review.approvedRevision !== review.revision) {
    throw new Error(`${PROVIDER_API_FAILURE}: Image foundation must be approved before animation`);
  }
}

async function updateJobStatus(
  jobId: string,
  fields: Partial<typeof jobsTable.$inferInsert>,
): Promise<void> {
  const claimToken = activeClaimTokens.get(jobId);
  const { progressPercent, ...remainingFields } = fields;
  const updated = await db
    .update(jobsTable)
    .set({
      ...remainingFields,
      // A resumed run replays earlier stages to validate/pull saved assets.
      // Progress represents completed durable work, so replay must never make
      // the customer-visible percentage move backward.
      ...(progressPercent === undefined
        ? {}
        : { progressPercent: sql`GREATEST(progress_percent, ${progressPercent})` }),
      updatedAt: new Date(),
    })
    .where(
      claimToken
        ? and(eq(jobsTable.id, jobId), eq(jobsTable.claimedAt, claimToken))
        : eq(jobsTable.id, jobId),
    )
    .returning({ id: jobsTable.id });
  if (claimToken && updated.length === 0) {
    throw new Error(`${OWNERSHIP_LOST} (status update claim fence)`);
  }
  await notifyJobUpdate(jobId);
}

async function getAudioBuffer(
  job: JobRow,
): Promise<{ buffer: Buffer; ext: string } | null> {
  // Uploaded file path
  if (job.audioObjectPath) {
    try {
      const buf = await storageService.downloadObjectBuffer(job.audioObjectPath);
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
    await withResourceLease("ffmpeg_light", ({ signal }) => execAsync(
      `ffmpeg -y -f lavfi -i color=c=0x1a0533:size=1280x720:rate=30 ` +
        `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 ` +
        `-t ${Math.min(durationSec, 10)} ` +
        `-c:v libx264 -preset ultrafast -crf 28 ` +
        `-c:a aac -shortest "${outPath}"`,
      { timeout: 30_000, signal },
    ));
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
  preparedImages: Record<string, string>,
  onProgress: (pct: number) => Promise<void>,
): Promise<{
  clips: GeneratedClip[];
  shortfallNotice?: string;
}> {
  const selectedProvider = (job as JobRow & { aiProvider?: string | null }).aiProvider?.trim().toLowerCase();
  const provider = selectedProvider || getActiveProvider();
  const requestedDur = (job as JobRow & { requestedDuration?: string | null }).requestedDuration;
  const generationMode = generationModeOf(job);
  const strictUniqueSources = isStrictUniqueSourcesJob(job);

  // Use the same clip plan as the credit formula so the number of provider calls
  // matches exactly what was charged.
  const { numClips: maxClips, clipDurationSec } = getClipPlan(
    requestedDur,
    analysis.durationSeconds,
    generationMode,
  );
  const photoAnimation = approvedPhotoAnimation(job);
  if (
    photoAnimation
    && (maxClips !== 1 || clipDurationSec !== photoAnimation.durationSeconds)
  ) {
    throw new Error(`${PROVIDER_API_FAILURE}: Photo animation plan is not exactly one approved clip`);
  }
  const storyboardShots = storyboardShotsOf(job);
  if (generationMode === "narrative" && storyboardShots.length !== maxClips) {
    throw new Error(
      `${PROVIDER_API_FAILURE}: Narrative plan expected ${maxClips} unique scenes but found ${storyboardShots.length}`,
    );
  }
  // selectSections picks the best unique sections; cycle through them to fill
  // the required clip count (matches worker's buildGenerationPlan approach).
  const baseSections = storyboardShots.length > 0
    ? storyboardShots.map((shot, index) => ({
        startTime: shot.startTime,
        endTime: storyboardShots[index + 1]?.startTime ?? shot.startTime + 10,
        label: shot.label,
        energy: shot.energy,
      }))
    : await selectSections(analysis.sections, maxClips);
  const sections: AudioSection[] = [];
  for (let i = 0; i < maxClips; i++) {
    sections.push(strictUniqueSources ? baseSections[i]! : baseSections[i % baseSections.length]!);
  }
  // Read salvage state before strict source validation. If every scene already
  // has either a stored clip or an accepted HTTPS poll handle, this run cannot
  // reach a new provider POST, so damaged legacy source images must not block
  // collection and stitching of already-paid outputs.
  const clipMeta = aiMetaOf(job);
  const persisted: Record<string, string> = { ...(clipMeta.partialClips ?? {}) };
  const pending: Record<string, string> = { ...(clipMeta.pendingRequests ?? {}) };
  const isSavedOutputOnlyRecovery = savedOutputsCoverEveryScene(
    sections.length,
    persisted,
    pending,
  );
  if (!isSavedOutputOnlyRecovery) {
    await validateStrictSourceFoundation(
      job,
      maxClips,
      clipDurationSec,
      targetOutputDuration(requestedDur, analysis.durationSeconds),
      preparedImages,
    );
  } else {
    logger.info(
      { jobId: job.id },
      "Skipping source-image validation because every scene has a saved clip or accepted request",
    );
  }

  const refImageUrl = await loadReferenceImageUrl(job);

  const clips: GeneratedClip[] = new Array(sections.length);

  // Salvage: any clips rendered on a previous attempt are persisted in the job
  // manifest. Reuse them instead of paying to regenerate — a retry only re-runs
  // the clips that actually failed.
  // Requests that were submitted (and paid for) on a previous attempt but whose
  // results were never downloaded — check the provider before regenerating.
  const submissionIntents = clipMeta.submissionIntents ?? {};
  const uncertainSubmissions = clipMeta.uncertainSubmissions ?? {};
  const targetedSceneIndex = clipMeta.targetedSceneRecovery?.sceneIndex;
  const targetedSceneRequestedAt = clipMeta.targetedSceneRecovery?.requestedAt;
  const allowTargetedTerminalSkip =
    !strictUniqueSources && clipMeta.targetedSceneRecovery?.allowTerminalSkip === true;
  const terminalFallbackProvider =
    clipMeta.targetedSceneRecovery?.terminalFallbackProvider;
  if (
    targetedSceneIndex !== undefined &&
    (
      clipMeta.targetedSceneRecovery?.assetType !== "clip" ||
      !Number.isInteger(targetedSceneIndex) ||
      targetedSceneIndex < 0 ||
      targetedSceneIndex >= sections.length ||
      typeof targetedSceneRequestedAt !== "string" ||
      targetedSceneRequestedAt.length === 0
    )
  ) {
    throw new Error(`${PROVIDER_API_FAILURE}: Targeted scene recovery is outside the immutable storyboard`);
  }
  const baseGenerationOrder = targetedSceneIndex === undefined
    ? sections.map((_, index) => index)
    : [
        targetedSceneIndex,
        ...sections.map((_, index) => index).filter((index) => index !== targetedSceneIndex),
      ];
  const generationOrder = pendingFirstOrder(baseGenerationOrder, pending);
  const skippedTerminalScenes = new Set<number>();
  const reuseCount = Object.keys(persisted).length;
  // Complete saved-output coverage is stronger than a stale finalize-only flag:
  // every scene can be reused or GET-polled, so no provider POST is reachable.
  const finalizeOnly =
    clipMeta.finalizeWithPartial === true && !isSavedOutputOnlyRecovery;

  logger.info(
    { jobId: job.id, provider, sectionCount: sections.length, maxClips, reuseCount },
    reuseCount ? "Generating clips per section (resuming — reusing rendered clips)" : "Generating clips per section",
  );
  const completedClipIndexes = new Set(
    Object.keys(persisted)
      .map(Number)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < sections.length),
  );
  // Admin "finalize with saved clips" may only stitch a complete strict
  // storyboard. Incomplete strict jobs must still stop without buying
  // replacement clips, while complete saved sets are allowed to assemble.
  if (
    strictUniqueSources &&
    finalizeOnly &&
    !hasCompleteSavedClipSet(persisted, sections.length)
  ) {
    throw new Error(`${PROVIDER_API_FAILURE}: Strict jobs cannot finalize with missing clips`);
  }
  let reportedProgress = Math.max(
    job.progressPercent ?? 0,
    30 + Math.floor((completedClipIndexes.size / sections.length) * 40),
  );
  await onProgress(reportedProgress);
  let progressWrites = Promise.resolve();
  const reportClipComplete = (index: number): Promise<void> => {
    progressWrites = progressWrites.then(async () => {
      completedClipIndexes.add(index);
      reportedProgress = Math.max(
        reportedProgress,
        30 + Math.floor((completedClipIndexes.size / sections.length) * 40),
      );
      await onProgress(reportedProgress);
    });
    return progressWrites;
  };

  // 4K clips are expensive, so don't burn a second full-price attempt on them;
  // everything else gets one in-clip retry before the whole job is failed.
  const is4k = ((job as JobRow & { resolution?: string | null }).resolution ?? "").toLowerCase() === "4k";
  const clipAttempts = is4k ? 1 : 2;

  const forceSequential =
    strictUniqueSources ||
    targetedSceneIndex !== undefined ||
    finalizeOnly ||
    Object.keys(submissionIntents).length > 0 ||
    Object.keys(uncertainSubmissions).length > 0 ||
    allowTargetedTerminalSkip ||
    Boolean(terminalFallbackProvider);
  const sceneConcurrency = resolveSceneConcurrency({
    requested: process.env.CLIP_GENERATION_CONCURRENCY,
    forceSequential,
  });
  let generationShortfallNotice: string | undefined;
  let generationShortfallError: unknown;
  let paidSceneStopReason: unknown;
  const processScene = async (i: number): Promise<void> => {
    const storyboardShot = strictUniqueSources || generationMode === "narrative"
      ? storyboardShots[i]!
      : storyboardShots.length > 0
        ? storyboardShots[i % storyboardShots.length]!
        : null;
    const section = sections[i]!;
    // Generate exactly one animation per immutable storyboard image. Montage
    // reuse happens later through storyboard.timeline during stitching; using
    // the timeline here would animate duplicate motifs and skip others.
    const visualIndex = storyboardShot?.index ?? i;
    const visualShot = storyboardShot;
    const targetDuration = clipDurationSec;
    const clipDuration = clipDurationSec;

    // Build the prompt regardless of provider so it can be persisted as clip
    // metadata (and reused as the basis for a future remix of this clip).
    const prompt = photoAnimation?.approvedPrompt
      ?? visualShot?.prompt
      ?? buildSectionPrompt(job, analysis, section);

    // 1) Reuse a previously-rendered clip if we have one (salvage on retry).
    if (persisted[i] && !pending[i]) {
      const savedPath = persisted[i]!;
      const deferred = lazyBuffer(async () => {
        try {
          return await readClipWithNoChargeRetry(job, i, savedPath, async () => {
            const url = await storageService.getObjectEntitySignedUrl(savedPath, 3600);
            return downloadClip(url);
          });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          if (detail.includes(OWNERSHIP_LOST) || detail.includes(PROVIDER_MEDIA_TERMINAL)) throw e;
          logger.warn(
            { jobId: job.id, clip: i, objectPath: savedPath, err: e },
            "Persisted clip unreadable during lazy materialization",
          );
          throw new Error(
            `${PROVIDER_POLL_TIMEOUT} Saved scene ${i + 1} is temporarily unavailable. Its stored output was preserved for recovery.`,
          );
        }
      });
      clips[i] = { ...deferred, targetDuration, prompt, visualIndex };
      if (targetedSceneIndex === i) {
        await persistTargetedSceneClip(job, i, savedPath, targetedSceneRequestedAt!);
      }
      logger.info({ jobId: job.id, clip: i }, "Queued previously-rendered clip for lazy salvage");
      await reportClipComplete(i);
      return;
    }

    // 2) Continue polling a request accepted on a previous attempt. This sends
    //    only GET status checks to its saved URL, never a duplicate paid POST.
    if (pending[i]) {
      try {
        logger.info(
          { jobId: job.id, clip: i },
          "Resuming accepted scene request (no new spend)",
        );
        const mediaUrl = await pollPixazoRequestUntilComplete(
          pending[i]!,
          () => assertJobOwned(job),
        );
        const buf = await readClipWithNoChargeRetry(job, i, mediaUrl, () => downloadClip(mediaUrl));
        clips[i] = { buffer: buf, targetDuration, prompt, visualIndex };
        try {
          const path = await storageService.uploadClipBuffer(buf, `job-${job.id}`, i);
          persisted[i] = path;
          if (targetedSceneIndex === i) {
            await persistTargetedSceneClip(
              job,
              i,
              path,
              targetedSceneRequestedAt!,
            );
          } else {
            await persistPartialClip(job.id, i, path);
          }
        } catch (e) {
          if (targetedSceneIndex === i) throw e;
          logger.warn({ jobId: job.id, clip: i, err: e }, "Could not persist recovered clip (non-fatal)");
        }
        logger.info({ jobId: job.id, clip: i }, "Recovered stranded clip from provider (no new spend)");
        delete pending[i];
        await reportClipComplete(i);
        return;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        if (detail.includes(OWNERSHIP_LOST) || detail.includes(PROVIDER_POLL_ABORTED)) {
          throw e;
        }
        if (detail.includes(PROVIDER_TERMINAL_FAILURE)) {
          if (targetedSceneIndex === i) {
            await persistTargetedRejectedRequest(
              job,
              i,
              pending[i]!,
              detail,
              targetedSceneRequestedAt!,
            );
          } else {
            await persistRejectedRequest(job.id, i, pending[i]!, detail);
          }
          delete pending[i];
          if (allowTargetedTerminalSkip && targetedSceneIndex === i) {
            skippedTerminalScenes.add(i);
            logger.warn(
              { jobId: job.id, clip: i },
              "Targeted replacement was terminally rejected — continuing remaining scenes and filling this slot from adjacent footage",
            );
            return;
          }
          throw e;
        }
        if (
          detail.includes(PROVIDER_API_FAILURE) ||
          detail.includes(PROVIDER_POLL_TIMEOUT)
        ) {
          throw e;
        }
        logger.warn({ jobId: job.id, clip: i, err: e }, "Stranded clip download failed — preserving request for recovery");
        throw new Error(`${PROVIDER_POLL_TIMEOUT} A completed AI scene is temporarily unavailable.`);
      }
    }

    if (submissionIntents[i] || uncertainSubmissions[i]) {
      throw new Error(
        `${PROVIDER_API_FAILURE} A previous AI scene submission has no confirmed request ID. No replacement request was submitted.`,
      );
    }

    // 3) Finalize-only mode: never generate new clips — skip anything that
    //    couldn't be reused/reclaimed for free.
    if (finalizeOnly) {
      logger.info({ jobId: job.id, clip: i }, "Finalize-only: skipping missing clip (no new spend)");
      return;
    }

    // 3b) Simulation fallback (no real provider configured).
    if (provider === "simulation") {
      if (strictUniqueSources) {
        throw new Error(`${PROVIDER_API_FAILURE}: Strict jobs require real, unique provider clips; simulation is disabled`);
      }
      logger.info({ jobId: job.id, section: section.label, clipDuration }, "Simulation: creating placeholder clip");
      await new Promise((r) => setTimeout(r, 1500));
      clips[i] = {
        buffer: await createSimulationClip(clipDuration),
        targetDuration,
        prompt,
        visualIndex,
      };
      await reportClipComplete(i);
      return;
    }

    // 4) Generate the clip, retrying THIS clip a couple of times before failing
    //    the whole job — so one flaky clip doesn't waste the ones already made.
    logger.info(
      { jobId: job.id, section: section.label, provider, prompt: prompt.slice(0, 80) },
      "Generating AI clip",
    );
    let clipBuffer: Buffer | null = null;
    let clipErr: unknown;
    let skipTerminalScene = false;
    for (let attempt = 1; attempt <= clipAttempts; attempt++) {
      await assertJobOwned(job);
      await assertApprovedImageReview(job);
      let acceptedRequest = false;
      try {
        const imagePath = preparedImages[visualIndex];
        if (usesGeneratedNarrativeImages(job) && !imagePath) {
          throw new Error(`${IMAGE_API_FAILURE}: Required planned visual is unavailable`);
        }
        const narrativeImageUrl = imagePath
          ? await storageService.getObjectEntitySignedUrl(imagePath, 3600)
          : refImageUrl ?? undefined;
        if (paidSceneStopReason !== undefined || generationShortfallNotice !== undefined) return;
        const intentPersisted = targetedSceneIndex === i
          ? await persistTargetedClipSubmissionIntent(
              job,
              i,
              provider,
              targetedSceneRequestedAt!,
            )
          : await persistClipSubmissionIntent(job, i, provider);
        if (!intentPersisted) {
          throw new Error(`${OWNERSHIP_LOST} (clip submission intent fence)`);
        }
        if (paidSceneStopReason !== undefined || generationShortfallNotice !== undefined) {
          await clearUnsubmittedClipIntent(job, i);
          return;
        }
        const result = await generateClip({
          prompt,
          durationSeconds: clipDuration,
          aspectRatio: job.aspectRatio ?? "16:9",
          imageUrl: narrativeImageUrl,
          // Pin the user's chosen engine (so "Kling" actually renders on Kling)
          // and do not submit paid fallback requests to unrelated engines.
          provider,
          providerOnly: true,
          terminalFallbackProvider:
            targetedSceneIndex === i ? terminalFallbackProvider : undefined,
          resolution: (job as JobRow & { resolution?: string | null }).resolution,
          // Persist the provider request id before polling starts so this clip
          // is recoverable if the server dies mid-poll.
          onSubmit: async (info) => {
            acceptedRequest = true;
            pending[i] = info.pollUrl;
            if (targetedSceneIndex === i) {
              await persistTargetedPendingRequest(
                job,
                i,
                info.pollUrl,
                targetedSceneRequestedAt!,
              );
            } else {
              await persistPendingRequest(job.id, i, info.pollUrl);
            }
          },
          onUncertainSubmission: (info) => targetedSceneIndex === i
            ? persistTargetedUncertainSubmission(
                job,
                i,
                info,
                targetedSceneRequestedAt!,
              )
            : persistUncertainSubmission(job.id, i, info),
          onTerminalFallback: targetedSceneIndex === i
            ? (info) => persistTargetedFallbackIntent(
                job,
                i,
                info.toProvider,
                targetedSceneRequestedAt!,
              )
            : undefined,
          assertContinue: () => assertJobOwned(job),
        });
        if (!result && strictUniqueSources) {
          throw new Error(`${PROVIDER_API_FAILURE}: Strict jobs cannot substitute a simulated clip`);
        }
        clipBuffer = result
          ? await readClipWithNoChargeRetry(job, i, result.videoUrl, () => downloadClip(result.videoUrl))
          : await createSimulationClip(clipDuration);
        if (result) {
          logger.info({ jobId: job.id, section: section.label, provider: result.provider }, "AI clip downloaded");
        }
        break;
      } catch (e) {
        clipErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes(OWNERSHIP_LOST) || msg.includes(PROVIDER_POLL_ABORTED)) {
          throw e;
        }
        if (
          acceptedRequest &&
          pending[i] &&
          msg.includes(PROVIDER_TERMINAL_FAILURE)
        ) {
          if (targetedSceneIndex === i) {
            await persistTargetedRejectedRequest(
              job,
              i,
              pending[i]!,
              msg,
              targetedSceneRequestedAt!,
            );
          } else {
            await persistRejectedRequest(job.id, i, pending[i]!, msg);
          }
          delete pending[i];
          if (allowTargetedTerminalSkip && targetedSceneIndex === i) {
            skippedTerminalScenes.add(i);
            skipTerminalScene = true;
            logger.warn(
              { jobId: job.id, clip: i },
              "Targeted replacement was terminally rejected — continuing remaining scenes and filling this slot from adjacent footage",
            );
            break;
          }
        }
        // Provider ran out of tokens (Pixazo 402 / quota / balance): if we
        // already have rendered clips, stop generating and salvage them —
        // the video is finished with fewer unique clips (looped to fill the
        // runtime) instead of throwing the whole job away.
        if (msg.includes(PROVIDER_OUT_OF_CREDITS)) {
          if (skippedTerminalScenes.size > 0) {
            throw e;
          }
          if (strictUniqueSources || generationMode === "narrative") throw e;
          generationShortfallNotice = "Out of tokens";
          generationShortfallError ??= e;
          return;
        }
        if (
          msg.includes(PROVIDER_API_FAILURE) ||
          msg.includes(PROVIDER_POLL_TIMEOUT) ||
          msg.includes(IMAGE_API_FAILURE) ||
          msg.includes(IMAGE_POLL_TIMEOUT) ||
          /moderation|content policy|safety system/i.test(msg)
        ) throw e;
        if (acceptedRequest) {
          throw new Error(`${PROVIDER_POLL_TIMEOUT} A saved AI scene result is temporarily unavailable.`);
        }
        throw new Error(`${PROVIDER_API_FAILURE} ${msg}`);
      }
    }
    if (skipTerminalScene) return;
    if (!clipBuffer) throw clipErr ?? new Error(`Clip ${i} failed to render`);

    // 5) Persist the successful clip so a future job retry can reuse it.
    try {
      const path = await storageService.uploadClipBuffer(clipBuffer, `job-${job.id}`, i);
      persisted[i] = path;
      if (targetedSceneIndex === i) {
        await persistTargetedSceneClip(
          job,
          i,
          path,
          targetedSceneRequestedAt!,
        );
      } else {
        await persistPartialClip(job.id, i, path);
      }
    } catch (e) {
      if (targetedSceneIndex === i) throw e;
      logger.warn({ jobId: job.id, clip: i, err: e }, "Could not persist salvage copy of clip (non-fatal)");
    }

    clips[i] = { buffer: clipBuffer, targetDuration, prompt, visualIndex };
    await reportClipComplete(i);
  };
  const pendingOrder = generationOrder.filter((index) => Boolean(pending[index]));
  const remainingOrder = generationOrder.filter((index) => !pending[index]);
  await runBoundedScenes(pendingOrder, sceneConcurrency, processScene);
  await runBoundedScenes(
    remainingOrder,
    sceneConcurrency,
    processScene,
    () => generationShortfallNotice === undefined && paidSceneStopReason === undefined,
    (error) => { paidSceneStopReason ??= error; },
  );
  await progressWrites;
  if (generationShortfallNotice) {
    const salvaged = clips.filter(Boolean);
    if (salvaged.length === 0) throw generationShortfallError;
    logger.warn(
      { jobId: job.id, done: salvaged.length, planned: sections.length },
      "Provider out of tokens — stopping generation and salvaging rendered clips",
    );
    return { clips: salvaged, shortfallNotice: generationShortfallNotice };
  }

  for (const skippedIndex of skippedTerminalScenes) {
    const adjacentClip = clips[skippedIndex - 1] ?? clips[skippedIndex + 1];
    if (!adjacentClip) {
      throw new Error(`${PROVIDER_API_FAILURE}: No adjacent story footage is available to cover skipped scene ${skippedIndex + 1}`);
    }
    await materializeLazyBuffers([adjacentClip]);
    const fallbackClip: GeneratedClip = {
      ...adjacentClip,
      targetDuration: clipDurationSec,
    };
    const path = await storageService.uploadClipBuffer(
      fallbackClip.buffer,
      `job-${job.id}`,
      skippedIndex,
    );
    clips[skippedIndex] = fallbackClip;
    persisted[skippedIndex] = path;
    await persistTargetedSceneClip(
      job,
      skippedIndex,
      path,
      targetedSceneRequestedAt!,
    );
    await reportClipComplete(skippedIndex);
    logger.warn(
      { jobId: job.id, clip: skippedIndex, adjacentClip: clips[skippedIndex - 1] ? skippedIndex - 1 : skippedIndex + 1 },
      "Filled terminally rejected scene slot with adjacent story footage",
    );
  }

  if (finalizeOnly) {
    const salvaged = clips.filter(Boolean);
    if (salvaged.length === 0) {
      throw new Error(`${PROVIDER_API_FAILURE}: Finalize requested but no rendered clips are available for this job`);
    }
    if (salvaged.length < sections.length) {
      if (generationMode === "narrative") {
        throw new Error(
          `${PROVIDER_API_FAILURE}: Narrative finalization requires all ${sections.length} planned scenes`,
        );
      }
      logger.warn(
        { jobId: job.id, salvaged: salvaged.length, planned: sections.length },
        "Finalize-only: stitching with fewer unique clips than planned",
      );
      return {
        clips: salvaged.map((c) => ({ ...c, targetDuration: clipDurationSec })),
        shortfallNotice: "Finalized with available clips",
      };
    }
    return { clips: salvaged };
  }

  return { clips };
}

// Upload each generated clip to object storage and assemble the clip metadata
// array persisted on videos.clips. Timestamps are cumulative across clips.
async function persistClips(
  videoId: string,
  clips: GeneratedClip[],
  style: string | null,
  sequence?: number[],
  totalDuration?: number,
  signal?: AbortSignal,
): Promise<VideoClipMeta[]> {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const objectPaths: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    signal?.throwIfAborted();
    const c = clips[i]!;
    let objectPath = "";
    try {
      objectPath = await storageService.uploadClipBuffer(c.buffer, videoId, i);
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      // Non-fatal: a missing clip just can't be reused by remix (it'll be
      // regenerated). Never fail the whole job over clip persistence.
      logger.warn({ err, videoId, index: i }, "Failed to persist clip for remix (non-fatal)");
    }
    objectPaths.push(objectPath);
  }

  const editOrder = sequence?.length ? sequence : clips.map((_, index) => index);
  const metas: VideoClipMeta[] = [];
  let cursor = 0;
  for (let i = 0; i < editOrder.length; i++) {
    const sourceIndex = ((editOrder[i]! % clips.length) + clips.length) % clips.length;
    const c = clips[sourceIndex]!;
    const remaining = totalDuration == null ? c.targetDuration : Math.max(0, totalDuration - cursor);
    const duration = Math.min(c.targetDuration, remaining);
    if (duration <= 0) break;
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    metas.push({
      index: i,
      startTime: round2(start),
      endTime: round2(end),
      durationSec: round2(duration),
      prompt: c.prompt,
      style,
      objectPath: objectPaths[sourceIndex] ?? "",
    });
  }
  return metas;
}

async function retryOrFail(job: JobRow, err: unknown): Promise<void> {
  const runSignal = getResourceLeaseExecutionContext()?.signal;
  if (runSignal?.aborted) err = runSignal.reason;
  const errMsg = err instanceof Error ? err.message : String(err);

  // Ownership was lost (stale recovery re-queued the job or another worker
  // claimed it). Another run owns this job now — do NOT touch its status or
  // schedule a retry, just stop quietly.
  if (errMsg.includes(OWNERSHIP_LOST)) {
    logger.warn({ jobId: job.id }, "Aborted run: job ownership lost, leaving job to its new owner");
    return;
  }

  if (errMsg.includes(ASSEMBLY_DEADLINE_EXCEEDED)) {
    const retryAfter = Date.now() + 60_000;
    const requeued = await db.execute<{ id: string }>(sql`
      UPDATE jobs SET
        status = 'queued',
        claimed_at = NULL,
        error_message = 'Final assembly took too long. Your saved clips are safe and assembly will retry automatically.',
        manifest = COALESCE(manifest, '{}'::jsonb) || jsonb_build_object(
          'retryAfter', ${retryAfter}::bigint,
          'completeSavedClipRecovery', true,
          'finalizeWithPartial', false
        ),
        updated_at = NOW()
      WHERE id = ${job.id}
        AND status = 'stitching'
        AND claimed_at = ${job.claimedAt}
      RETURNING id
    `);
    if (requeued.rows.length > 0) {
      logger.warn({ jobId: job.id, retryAfter }, "Assembly deadline requeued saved clips at no charge");
      await notifyJobUpdate(job.id);
    }
    return;
  }

  if (job.jobType === "preview_backfill") {
    const retryAfter = Date.now() + 60_000;
    const nextRetry = job.retryCount + 1;
    if (nextRetry <= MAX_RETRIES) {
      await db.execute(sql`
        UPDATE jobs SET
          status = 'queued',
          claimed_at = NULL,
          retry_count = ${nextRetry},
          error_message = 'Browser preview creation will retry automatically.',
          manifest = COALESCE(manifest, '{}'::jsonb)
            || jsonb_build_object('retryAfter', ${retryAfter}::bigint),
          updated_at = NOW()
        WHERE id = ${job.id}
          AND claimed_at = ${job.claimedAt}
          AND job_type = 'preview_backfill'
      `);
      return;
    }
    await db.execute(sql`
      UPDATE jobs SET
        status = 'failed',
        claimed_at = NULL,
        error_message = 'Browser preview creation failed. The full-quality video remains available.',
        updated_at = NOW()
      WHERE id = ${job.id}
        AND claimed_at = ${job.claimedAt}
        AND job_type = 'preview_backfill'
    `);
    void notifyAdminRenderFailed(job, "Browser preview backfill failed.");
    return;
  }

  if (errMsg.includes(INFRASTRUCTURE_RETRY) || isTransientInfrastructureError(err)) {
    const retryAfter = Date.now() + 60_000;
    const requeued = await db.execute<{ id: string }>(sql`
      UPDATE jobs SET
        status = 'queued',
        claimed_at = NULL,
        error_message = 'A temporary service interruption occurred. Your saved work is safe and will resume automatically.',
        manifest = COALESCE(manifest, '{}'::jsonb) || jsonb_build_object(
          'retryAfter', ${retryAfter}::bigint,
          'infrastructureRetryCount',
            COALESCE((manifest->>'infrastructureRetryCount')::integer, 0) + 1,
          'finalizeWithPartial', false
        ),
        updated_at = NOW()
      WHERE id = ${job.id}
        AND status IN ('analyzing', 'generating', 'stitching')
        AND claimed_at = ${job.claimedAt}
        AND COALESCE((manifest->>'infrastructureRetryCount')::integer, 0)
          < ${MAX_INFRASTRUCTURE_RETRIES}
      RETURNING id
    `);
    if (requeued.rows.length > 0) {
      logger.warn(
        { jobId: job.id, retryAfter },
        "Temporary infrastructure interruption requeued at no charge",
      );
      await notifyJobUpdate(job.id);
      return;
    }

    const terminalErrorMessage =
      "Repeated service interruptions prevented this render from resuming safely. Credits for unfinished work were returned.";
    const settlement = await settleImageFirstReservation(job.id, job.userId, {
      expectedClaimedAt: job.claimedAt,
      terminalErrorMessage,
    });
    if (!settlement.ownershipMatched) {
      logger.info({ jobId: job.id }, "Infrastructure retry result ignored after ownership changed");
      return;
    }
    void notifyAdminRenderFailed(job, "Infrastructure recovery limit reached.");
    return;
  }

  logger.error({ err, jobId: job.id, retryCount: job.retryCount }, "Job failed");

  // Pixazo Lip Sync requests may be billable at submission. Never auto-retry
  // this job type: a second request could create duplicate provider spend
  // without guaranteeing that the original request cannot still complete.
  if (job.jobType === "runway_lipsync") {
    const meta = aiMetaOf(job) as AiJobMeta & { publicLipSync?: boolean };
    if (meta.publicLipSync) {
      await refundReservation(job.id, job.userId, "lip-sync-failure");
    }
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: meta.publicLipSync
        ? "AI Lip Sync could not finish. Your reserved credits were returned. No automatic retry was attempted."
        : "AI Lip Sync could not finish. No automatic retry was attempted to prevent duplicate charges.",
    });
    void notifyAdminRenderFailed(job, errMsg);
    return;
  }

  // Moderation / content-policy failures will never succeed on retry — fail fast.
  if (/moderation|content policy|safety system/i.test(errMsg)) {
    logger.warn({ jobId: job.id }, "Permanent failure: content moderation rejection, skipping retries");
    await refundReservation(job.id, job.userId, "moderation");
    await cleanupPartialClips(job.id).catch(() => {});
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage:
        "Your prompt was rejected by the AI provider's content policy. Please edit your prompt and try again.",
    });
    void notifyAdminRenderFailed(job, "The AI provider's content policy rejected the prompt.");
    return;
  }

  // A polling deadline is safe to recover ONLY when the already-paid request
  // was durably saved. Requeueing then resumes a GET status check and cannot
  // submit or charge for a second provider request.
  if (
    errMsg.includes(IMAGE_POLL_TIMEOUT)
    || errMsg.includes(PROVIDER_POLL_TIMEOUT)
    || errMsg.includes(PROVIDER_POLL_ABORTED)
  ) {
    const liveMeta = await readAiMeta(job.id);
    const imageTimeout = errMsg.includes(IMAGE_POLL_TIMEOUT);
    const hasPersistedRequest = imageTimeout
      ? Object.keys(liveMeta.pendingImageRequests ?? {}).length > 0
      : Object.keys(liveMeta.pendingRequests ?? {}).length > 0;
    const pollRecovery = planNoChargePollRecovery(liveMeta, imageTimeout);
    if (hasPersistedRequest && pollRecovery.canRetry) {
      const delayMs = Math.min(Math.pow(2, pollRecovery.nextCount) * 60_000, 5 * 60_000);
      const retryAfter = Date.now() + delayMs;
      const cleanMsg = errMsg
        .replace(IMAGE_POLL_TIMEOUT, "")
        .replace(PROVIDER_POLL_TIMEOUT, "")
        .replace(PROVIDER_POLL_ABORTED, "")
        .trim();
      const requeued = await requeueSavedPollAtNoCharge(
        job.id,
        job.claimedAt,
        imageTimeout ? "image" : "provider",
        `${cleanMsg} — safely resuming the saved request at no charge (${pollRecovery.nextCount}/${MAX_NO_CHARGE_POLL_RECOVERIES})`,
        retryAfter,
      );
      if (requeued) {
        logger.info(
          { jobId: job.id, nextRecoveryCount: requeued.recovery_count, imageTimeout },
          "Polling timeout safely requeued using persisted provider request",
        );
        await notifyJobUpdate(job.id);
        return;
      }
    }

    const cleanMsg = errMsg
      .replace(IMAGE_POLL_TIMEOUT, "")
      .replace(PROVIDER_POLL_TIMEOUT, "")
      .replace(PROVIDER_POLL_ABORTED, "")
      .trim();
    try {
      await assertJobOwned(job);
    } catch {
      logger.info({ jobId: job.id }, "Timeout failure ignored because this run no longer owns the job");
      return;
    }
    await refundReservation(job.id, job.userId, "poll-timeout-exhausted");
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: hasPersistedRequest
        ? `${cleanMsg} The safe recovery limit was reached. Credits for unfinished work were returned.`
        : `${cleanMsg} No saved request was available to resume. Credits for unfinished work were returned.`,
    });
    void notifyAdminRenderFailed(job, cleanMsg);
    return;
  }

  // Source-image calls are paid and an interrupted submit may still be
  // uncertain. Never auto-resubmit blindly. Refund the idempotent
  // reservation and let the user explicitly start a fresh attempt; any images
  // that completed remain available in their generated-image library.
  if (errMsg.includes(IMAGE_API_FAILURE)) {
    const cleanMsg = errMsg.replace(IMAGE_API_FAILURE, "").replace(/^:\s*/, "").trim();
    logger.warn({ jobId: job.id }, "Permanent failure: source-image stage error — not retrying");
    await refundReservation(job.id, job.userId, "image-foundation-failure");
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: `${cleanMsg || "The source-image pack could not be completed."} Credits for unfinished work were returned. No automatic retry was attempted.`,
    });
    void notifyAdminRenderFailed(job, cleanMsg || "Source-image stage failed.");
    return;
  }

  // AI provider API failures (Kling/Pixazo) are never retried — charges happen
  // at submission time, so re-queuing only causes additional billing with no
  // guarantee of a different outcome.
  if (errMsg.includes(PROVIDER_API_FAILURE)) {
    const cleanMsg = errMsg
      .replace(PROVIDER_API_FAILURE, "")
      .replace(PROVIDER_MEDIA_TERMINAL, "")
      .trim();
    logger.warn({ jobId: job.id }, "Permanent failure: AI provider error — not retrying to avoid repeated charges");
    const meta = aiMetaOf(job);
    if (
      usesGeneratedNarrativeImages(job)
      || (meta.bundledLipSyncEnabled && !meta.bundledLipSyncActivated)
    ) {
      await refundReservation(job.id, job.userId, "source-provider-failure");
    }
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage:
        meta.bundledLipSyncEnabled && !meta.bundledLipSyncActivated
          ? `${cleanMsg} Credits for unfinished work were returned and AI Lip Sync was not started.`
          : usesGeneratedNarrativeImages(job)
            ? `${cleanMsg} Credits for unfinished work were returned.`
            : cleanMsg,
    });
    void notifyAdminRenderFailed(job, cleanMsg);
    return;
  }

  // Retries are now cheap: successfully-rendered clips are persisted and reused,
  // so a retry only regenerates the clips that actually failed. That means even
  // 4K / long jobs can safely retry transient errors without re-paying for the
  // whole render, so all jobs share the same retry budget.
  const maxRetries: number = MAX_RETRIES;

  const nextRetry = (job.retryCount ?? 0) + 1;

  if (nextRetry < maxRetries) {
    // Provider-stage retries can incur real spend and must be paid for again.
    // Assembly-only retries reuse clips already saved in object storage, make
    // no provider call, and must never charge the user again.
    // The charge and the durable retry schedule are committed in ONE atomic
    // statement (data-modifying CTE): either the credits are deducted AND the
    // job is re-queued with manifest.retryAfter, or neither happens — a crash
    // can never orphan a charge. The poll loop skips queued jobs whose
    // retryAfter is still in the future, so the schedule survives restarts.
    // Finalize-only runs make no provider calls, so a retry of one must be
    // free — never charge credits for them.
    const liveMeta = await readAiMeta(job.id);
    const savedClipCount = Object.keys(liveMeta.partialClips ?? {}).length;
    const assemblyOnlyRetry =
      liveMeta.completeSavedClipRecovery === true ||
      liveMeta.finalizeWithPartial === true ||
      (savedClipCount > 0 && /ffmpeg|stitch|video processing/i.test(errMsg));
    const pendingBundle =
      liveMeta.bundledLipSyncEnabled === true && liveMeta.bundledLipSyncActivated !== true;
    const retryCost = assemblyOnlyRetry || pendingBundle
      ? 0
      : imageFirstAutomaticRetryCost(liveMeta);
    const delayMs = Math.pow(2, nextRetry) * 60_000;
    const retryAfter = Date.now() + delayMs;
    const retryManifestPatch = JSON.stringify({
      retryAfter,
      finalizeWithPartial: assemblyOnlyRetry,
    });
    const noteMsg = assemblyOnlyRetry
      ? `${errMsg} — retry ${nextRetry}/${maxRetries} in ${delayMs / 60_000}m using saved scenes at no charge`
      : `${errMsg} — retry ${nextRetry}/${maxRetries} in ${delayMs / 60_000}m`;

    // `target` fences the charge on still OWNING the job: if the watchdog (or
    // anything else) already re-queued/failed this row, its status is no longer
    // a processing state, target is empty, and neither the charge nor the
    // requeue fires — a stale runner can never double-charge or clobber state.
    const requeued = await db.execute<{ id: string }>(sql`
      WITH target AS (
        SELECT id FROM jobs
        WHERE id = ${job.id} AND status IN ('analyzing', 'generating', 'stitching')
          AND claimed_at = ${job.claimedAt}
        FOR UPDATE SKIP LOCKED
      ),
      charged AS (
        UPDATE credits SET
          subscription_credits = GREATEST(subscription_credits - ${retryCost}, 0),
          topup_credits = GREATEST(topup_credits - GREATEST(${retryCost} - subscription_credits, 0), 0),
          credits_remaining = credits_remaining - ${retryCost},
          credits_used = credits_used + ${retryCost},
          updated_at = NOW()
        WHERE ${retryCost} > 0 AND user_id = ${job.userId} AND credits_remaining >= ${retryCost}
          AND EXISTS (SELECT 1 FROM target)
        RETURNING user_id
      )
      UPDATE jobs SET
        status = 'queued',
        error_message = ${noteMsg},
        retry_count = ${nextRetry},
        claimed_at = NULL,
        manifest = COALESCE(manifest, '{}'::jsonb) || ${retryManifestPatch}::jsonb,
        updated_at = NOW()
      WHERE id IN (SELECT id FROM target)
        AND (${retryCost} <= 0 OR EXISTS (SELECT 1 FROM charged))
      RETURNING id
    `);

    if (requeued.rows.length === 0) {
      // Either we lost ownership (watchdog already re-queued/failed the job) or
      // the owner can't pay. Fail permanently ONLY when the job is still ours
      // and the balance genuinely can't cover another attempt.
      const failed = await db.execute<{ id: string }>(sql`
        UPDATE jobs SET
          status = 'failed',
          claimed_at = NULL,
          error_message = ${`${errMsg} (not enough credits to retry — each attempt costs ${retryCost} credits)`},
          updated_at = NOW()
        WHERE id = ${job.id} AND status IN ('analyzing', 'generating', 'stitching')
          AND claimed_at = ${job.claimedAt}
          AND ${retryCost} > 0
          AND NOT EXISTS (
            SELECT 1 FROM credits
            WHERE user_id = ${job.userId} AND credits_remaining >= ${retryCost}
          )
        RETURNING id
      `);
      if (failed.rows.length > 0) {
        logger.warn(
          { jobId: job.id, userId: job.userId, retryCost },
          "Insufficient credits for retry — failing job permanently",
        );
        await cleanupPartialClips(job.id).catch(() => {});
        await notifyJobUpdate(job.id);
        void notifyAdminRenderFailed(job, errMsg);
      } else {
        logger.info(
          { jobId: job.id },
          "Retry not scheduled — job no longer owned by this runner (skipping)",
        );
      }
      return;
    }

    logger.info(
      { jobId: job.id, nextRetry, delayMs, maxRetries, retryCost },
      "Retry scheduled (attempt charged)",
    );
    await notifyJobUpdate(job.id);
  } else {
    // Out of retries — permanently failed. No refund: every attempt (including
    // the up-front reservation) incurred real provider spend, so the credits
    // stay deducted. Keep any salvage copies (partial clips) so the admin can
    // recover the job, and alert the admin to attempt a fix rather than telling
    // the user it's dead.
    const meta = await readAiMeta(job.id);
    if (meta.bundledLipSyncEnabled && !meta.bundledLipSyncActivated) {
      await refundReservation(job.id, job.userId, "bundled-source-retries-exhausted");
    }
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage:
        meta.bundledLipSyncEnabled && !meta.bundledLipSyncActivated
          ? `${errMsg} (max ${maxRetries} ${maxRetries === 1 ? "attempt" : "retries"} reached; combined reservation returned)`
          : `${errMsg} (max ${maxRetries} ${maxRetries === 1 ? "attempt" : "retries"} reached)`,
    });
    void notifyAdminRenderFailed(job, errMsg);
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
  segments: {
    objectPath: string;
    kind: "video" | "photo";
    durationSec: number;
    trimStart?: number;
    trimEnd?: number;
  }[];
  music?: {
    objectPath: string;
    mode: "mix" | "replace";
    volume: number;
    loop?: boolean;
    fade?: boolean;
  };
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
        const buf = await storageService.downloadObjectBuffer(s.objectPath);
        const ext = extFromObjectPath(s.objectPath, s.kind === "photo" ? "jpg" : "mp4");
        segments.push({
          buffer: buf,
          kind: s.kind,
          durationSec: s.durationSec,
          ext,
          trimStart: s.trimStart,
          trimEnd: s.trimEnd,
        });
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
        const buf = await storageService.downloadObjectBuffer(manifest.music.objectPath);
        const ext = extFromObjectPath(manifest.music.objectPath, "mp3");
        music = {
          buffer: buf,
          ext,
          mode: manifest.music.mode,
          volume: manifest.music.volume,
          loop: manifest.music.loop,
          fade: manifest.music.fade,
        };
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
    const transitionDroppedForRetry =
      isRetry && effectiveTransition === undefined && !!manifest.transition && manifest.transition.type !== "none";
    if (transitionDroppedForRetry) {
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
        { jobId: job.id, segments: segments.length, reason: result.transitionDropReason },
        "Transitions disabled — used hard-cut concat",
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
    const [videoObjectPath, thumbnailObjectPath, previewObjectPath] = await Promise.all([
      storageService.uploadVideoBuffer(result.videoBuffer, videoId),
      storageService.uploadThumbnailBuffer(result.thumbnailBuffer, videoId),
      createAndUploadWebPreview(result.videoBuffer, videoId, result.durationSeconds),
    ]);

    await db.insert(videosTable).values({
      id: videoId,
      userId: job.userId,
      jobId: job.id,
      videoObjectPath,
      previewObjectPath,
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

    // Surface removed files (and a dropped transition) to the user on the
    // finished job — the job page shows this note alongside the completed
    // video, so "my transition didn't work" has a real answer instead of a
    // silently-successful hard cut.
    const removedNotice = removedFiles.length
      ? `Note: ${removedFiles.length === 1 ? "1 file" : `${removedFiles.length} files`} couldn't be processed and ${removedFiles.length === 1 ? "was" : "were"} removed from your video: ${removedFiles.join(", ")}. The rest of your files rendered normally.`
      : null;
    const transitionNotice = result.transitionsDisabled
      ? (result.transitionDropReason ?? "Note: your chosen transition couldn't be applied to this export, so clips were joined with a hard cut instead.")
      : transitionDroppedForRetry
        ? "Note: your first export attempt hit a hiccup, so the retry that succeeded used hard cuts instead of your chosen transition. Try the export again to get the transition."
        : null;
    const combinedNotice = [removedNotice, transitionNotice].filter(Boolean).join(" ") || null;
    await updateJobStatus(job.id, {
      status: "ready",
      progressPercent: 100,
      videoId,
      errorMessage: combinedNotice,
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
          buffer = await storageService.downloadObjectBuffer(clip.objectPath);
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
    } else if (built.length > 0) {
      // Silent remix — stitch all clips (and burn captions) without audio.
      const stitchResult = await stitchVideoClips({
        clips: built.map((c) => ({ buffer: c.buffer, targetDuration: c.targetDuration })),
        totalDuration,
        lyricsText: (job as JobRow & { lyricsText?: string | null }).lyricsText ?? undefined,
      });
      videoBuffer = stitchResult.videoBuffer;
      thumbnailBuffer = stitchResult.thumbnailBuffer;
    } else {
      videoBuffer = await createSimulationClip(10);
      thumbnailBuffer = await extractVideoThumbnail(videoBuffer, 2);
    }

    await updateJobStatus(job.id, { progressPercent: 90 });

    const newVideoId = randomUUID();
    const [videoObjectPath, thumbnailObjectPath, previewObjectPath] = await Promise.all([
      storageService.uploadVideoBuffer(videoBuffer, newVideoId),
      storageService.uploadThumbnailBuffer(thumbnailBuffer, newVideoId),
      createAndUploadWebPreview(videoBuffer, newVideoId, totalDuration),
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
      previewObjectPath,
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

// Manifest shape for jobType="runway_lipsync" -- retained for database
// compatibility; the admin-only generator now runs through Pixazo.
type RunwayLipsyncMeta = {
  reservedCredits?: number;
  reservedSubscriptionCredits?: number;
  reservedTopupCredits?: number;
  refunded?: boolean;
  lipSyncEnabled?: boolean;
  publicLipSync?: boolean;
  sourceVideoId?: string;
  sourceVideoTitle?: string;
  lipSyncPollUrl?: string;
};

// Single-pass, Pixazo-only render for the admin Lip Sync Generator.
// One finished video, never a fallback to Runway/Kling/Luma:
//   - Lip Sync ON: generateLipsync (Pixazo OmniHuman audio-driven performance).
//   - Lip Sync OFF: a Pixazo image-to-video render, then the chosen song
//     segment is muxed on as a plain soundtrack.
async function processRunwayLipSyncJob(job: JobRow): Promise<void> {
  logger.info({ jobId: job.id }, "Processing admin Pixazo Lip Sync job");
  try {
    const meta = (job.manifest as unknown as RunwayLipsyncMeta | null) ?? {};
    const lipSyncEnabled = meta.lipSyncEnabled !== false;

    await updateJobStatus(job.id, { status: "generating", progressPercent: 10 });

    const imageUrl = await loadReferenceImageUrl(job);
    if (!imageUrl) {
      throw new Error("A character/reference image is required for AI Lip Sync.");
    }

    const durationSeconds = Math.min(
      Math.max(parseInt(job.requestedDuration ?? "15", 10) || 15, 5),
      30,
    );

    // Pull + trim the selected song segment, if one was provided.
    let audioData: { buffer: Buffer; ext: string } | null = null;
    if (job.audioObjectPath || (job.audioSourceType === "suno" && job.audioSourceUrl)) {
      const raw = await getAudioBuffer(job);
      if (raw) {
        const start = job.clipStartTime && job.clipStartTime > 0 ? job.clipStartTime : 0;
        audioData = await extractAudioClip(raw, start, durationSeconds);
      }
    }

    let outputUrl: string;
    if (lipSyncEnabled) {
      if (!lipsyncAvailable()) {
        throw new Error(
          `${PROVIDER_API_FAILURE} Pixazo audio-driven character lip sync is not available -- not falling back to another provider.`,
        );
      }
      if (!audioData) {
        throw new Error(
          `${PROVIDER_API_FAILURE} Lip Sync is enabled but no song segment was available to perform to.`,
        );
      }
      await assertJobOwned(job);
      const lipsyncAudioPath = await storageService.uploadAudioBuffer(
        audioData.buffer,
        `lipsync-${job.id}`,
        audioData.ext,
      );
      const audioUrl = await storageService.getObjectEntitySignedUrl(lipsyncAudioPath, 3600);
      await updateJobStatus(job.id, { progressPercent: 25 });
      const liveMeta = (await readAiMeta(job.id)) as RunwayLipsyncMeta;
      outputUrl = await generateLipsync({
        imageUrl,
        audioUrl,
        existingPollUrl: liveMeta.lipSyncPollUrl,
        onSubmitted: (pollUrl) => persistLipSyncPollUrl(job.id, pollUrl),
      });
      await assertJobOwned(job);
    } else {
      await assertJobOwned(job);
      await updateJobStatus(job.id, { progressPercent: 25 });
      const result = await generateClip({
        prompt: job.prompt ?? "",
        durationSeconds,
        aspectRatio: job.aspectRatio ?? "16:9",
        imageUrl,
        provider: "pixazo",
        providerOnly: true,
      });
      if (!result) throw new Error(`${PROVIDER_API_FAILURE} Pixazo did not return a video.`);
      outputUrl = result.videoUrl;
    }

    await updateJobStatus(job.id, { status: "stitching", progressPercent: 70 });
    const rawVideoBuffer = await downloadClip(outputUrl);

    let videoBuffer: Buffer;
    let thumbnailBuffer: Buffer;
    if (!lipSyncEnabled && audioData) {
      // Plain Pixazo render has no audio track -- mux the chosen song segment
      // on as the soundtrack. Lip Sync mode's output already has the
      // performance's audio muxed in by Pixazo, so it's used as-is.
      const stitchResult = await stitchVideoClips({
        clips: [{ buffer: rawVideoBuffer, targetDuration: durationSeconds }],
        audioBuffer: audioData.buffer,
        audioExt: audioData.ext,
        totalDuration: durationSeconds,
      });
      videoBuffer = stitchResult.videoBuffer;
      thumbnailBuffer = stitchResult.thumbnailBuffer;
    } else {
      videoBuffer = rawVideoBuffer;
      thumbnailBuffer = await extractVideoThumbnail(videoBuffer, Math.min(1, durationSeconds / 2));
    }

    await updateJobStatus(job.id, { progressPercent: 90 });

    const videoId = randomUUID();
    const [videoObjectPath, thumbnailObjectPath, previewObjectPath] = await Promise.all([
      storageService.uploadVideoBuffer(videoBuffer, videoId),
      storageService.uploadThumbnailBuffer(thumbnailBuffer, videoId),
      createAndUploadWebPreview(videoBuffer, videoId, durationSeconds),
    ]);

    await db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ status: jobsTable.status, claimedAt: jobsTable.claimedAt })
        .from(jobsTable)
        .where(eq(jobsTable.id, job.id))
        .limit(1)
        .for("update");
      const ours = job.claimedAt ? new Date(job.claimedAt).getTime() : null;
      const current = owned?.claimedAt ? new Date(owned.claimedAt).getTime() : null;
      if (!owned || owned.status === "queued" || owned.status === "failed" || ours !== current) {
        throw new Error(`${OWNERSHIP_LOST} (finalization fence)`);
      }

      await tx.insert(videosTable).values({
        id: videoId,
        userId: job.userId,
        jobId: job.id,
        videoObjectPath,
        previewObjectPath,
        thumbnailObjectPath,
        title: meta.publicLipSync
          ? `${meta.sourceVideoTitle?.trim() || "Video"} — lip sync`.slice(0, 120)
          : job.prompt?.trim().slice(0, 80) || (lipSyncEnabled ? "AI Lip Sync test" : "AI test render"),
        durationSeconds,
        style: job.style,
        prompt: job.prompt,
        shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
      });
      await tx
        .update(jobsTable)
        .set({ status: "ready", progressPercent: 100, videoId, updatedAt: new Date() })
        .where(eq(jobsTable.id, job.id));
    });

    await notifyJobUpdate(job.id);
    void notifyRenderReady(job);
    logger.info({ jobId: job.id, videoId, lipSyncEnabled }, "Admin Pixazo Lip Sync job completed");
  } catch (err) {
    await retryOrFail(job, err);
  }
}

async function processJobInner(job: JobRow, supervisor: JobRunSupervisor): Promise<void> {
  if (job.jobType === "narration") {
    await processNarrationJob(job);
    return;
  }
  if (job.jobType === "podcast") {
    await processPodcastJob(job);
    return;
  }
  if (job.jobType === "preview_backfill") {
    try {
      if (!job.videoId) throw new Error("Preview backfill is missing its target video.");
      const [video] = await db
        .select()
        .from(videosTable)
        .where(eq(videosTable.id, job.videoId))
        .limit(1);
      if (!video) throw new Error("The target video no longer exists.");
      if (video.previewObjectPath) {
        await updateJobStatus(job.id, { status: "ready", progressPercent: 100 });
        return;
      }
      const expectedPreviewPath = `/objects/video-previews/${video.id}.mp4`;
      if (await storageService.objectExists(expectedPreviewPath)) {
        try {
          await finalizePreviewBackfill(job, video.id, expectedPreviewPath);
        } catch (err) {
          if (err instanceof Error && err.message.includes(PREVIEW_TARGET_GONE)) {
            await storageService.deleteObject(expectedPreviewPath).catch(() => {});
          }
          throw err;
        }
        return;
      }
      await updateJobStatus(job.id, { status: "generating", progressPercent: 10 });
      const master = await storageService.downloadObjectBuffer(video.videoObjectPath);
      await assertJobOwned(job);
      await updateJobStatus(job.id, { progressPercent: 35 });
      const previewPath = await createAndUploadWebPreview(
        master,
        video.id,
        video.durationSeconds ?? 0,
      );
      if (!previewPath) throw new Error("Browser preview encoding failed.");
      await assertJobOwned(job);
      try {
        await finalizePreviewBackfill(job, video.id, previewPath);
      } catch (err) {
        if (err instanceof Error && err.message.includes(PREVIEW_TARGET_GONE)) {
          await storageService.deleteObject(previewPath).catch(() => {});
        }
        throw err;
      }
      await notifyJobUpdate(job.id);
      logger.info({ jobId: job.id, videoId: video.id, previewPath }, "Preview backfill completed");
    } catch (err) {
      await retryOrFail(job, err);
    }
    return;
  }
  if (job.jobType === "image_pack") {
    await processImagePackJob(job);
    return;
  }
  if (job.jobType === "editor_render") {
    await processEditorJob(job);
    return;
  }
  if (job.jobType === "remix") {
    await processRemixJob(job);
    return;
  }
  if (job.jobType === "runway_lipsync") {
    await processRunwayLipSyncJob(job);
    return;
  }

  logger.info({ jobId: job.id, style: job.style, provider: getActiveProvider() }, "Processing job");

  try {
    // === ANALYZING ===
    await updateJobStatus(job.id, { progressPercent: Math.max(job.progressPercent ?? 0, 5) });

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

    const recoveryMeta = aiMetaOf(job);
    const completeSavedClipRecovery =
      recoveryMeta.completeSavedClipRecovery === true &&
      hasCompleteSavedClipSet(
        recoveryMeta.partialClips ?? {},
        recoveryMeta.storyboard?.numClips ?? 0,
      );
    if (recoveryMeta.completeSavedClipRecovery === true && !completeSavedClipRecovery) {
      throw new Error(`${PROVIDER_API_FAILURE}: Saved-clip recovery is incomplete; no provider request was submitted.`);
    }
    const preparedImages = completeSavedClipRecovery
      ? {}
      : await prepareNarrativeImages(job);
    if (completeSavedClipRecovery) {
      logger.info(
        { jobId: job.id, savedClips: Object.keys(recoveryMeta.partialClips ?? {}).length },
        "Skipping image preparation for complete saved-clip stitching recovery",
      );
    }
    const reviewMeta = await readAiMeta(job.id);
    if (!completeSavedClipRecovery && isAwaitingImageApproval(reviewMeta)) {
      await processImageReviewReplacements(job);
      logger.info({ jobId: job.id }, "Image-first job paused for image approval");
      return;
    }
    await updateJobStatus(job.id, {
      status: "generating",
      audioAnalysis: analysis as unknown as Record<string, unknown>,
      progressPercent: 25,
    });

    // === GENERATING ===
    const { clips, shortfallNotice } = await generateClips(job, analysis, preparedImages, (pct) =>
      updateJobStatus(job.id, { progressPercent: pct }),
    );

    await updateJobStatus(job.id, { status: "stitching", progressPercent: 75 });

    // === STITCHING ===
    supervisor.startAssemblyDeadline();
    supervisor.throwIfAborted();
    await materializeLazyBuffers(clips);
    supervisor.throwIfAborted();
    logger.info({ jobId: job.id, clipCount: clips.length }, "Stitching clips with audio");

    const lyricsText = (job as JobRow & { lyricsText?: string | null }).lyricsText ?? undefined;

    let videoBuffer: Buffer;
    let thumbnailBuffer: Buffer;

    const reqDur = (job as JobRow & { requestedDuration?: string | null }).requestedDuration;
    const outputDuration = targetOutputDuration(reqDur, analysis.durationSeconds);
    const generationMode = generationModeOf(job);
    const strictUniqueSources = isStrictUniqueSourcesJob(job);
    const requestedSequence = strictUniqueSources
      ? resolveStrictMontageSequence(
          aiMetaOf(job).storyboard?.timeline,
          clips,
          outputDuration,
          clips[0]?.targetDuration ?? 10,
        )
      : generationMode === "narrative"
      ? clips.map((_, index) => index)
      : resolveMontageSequence(
          aiMetaOf(job).storyboard?.timeline,
          clips,
          outputDuration,
          clips[0]?.targetDuration ?? 10,
        );
    let resolvedSequence = requestedSequence;
    if (audioData) {
      const stitchResult = await stitchVideoClips({
        clips,
        sequence: requestedSequence,
        strictSequence: strictUniqueSources || generationMode === "narrative",
        audioBuffer: audioData.buffer,
        audioExt: audioData.ext,
        totalDuration: outputDuration,
        lyricsText,
      });
      videoBuffer = stitchResult.videoBuffer;
      thumbnailBuffer = stitchResult.thumbnailBuffer;
      resolvedSequence = stitchResult.resolvedSequence;
    } else if (clips.length > 0) {
      // No audio — either the user intentionally chose "no audio" (a silent
      // video meant to get a soundtrack added later in the Editor), or audio
      // couldn't be loaded. Either way, stitch every generated clip into one
      // silent video rather than discarding all but the first clip.
      const stitchResult = await stitchVideoClips({
        clips,
        sequence: requestedSequence,
        strictSequence: strictUniqueSources || generationMode === "narrative",
        totalDuration: outputDuration,
        lyricsText, // captions burn onto silent videos too
      });
      videoBuffer = stitchResult.videoBuffer;
      thumbnailBuffer = stitchResult.thumbnailBuffer;
      resolvedSequence = stitchResult.resolvedSequence;
    } else {
      if (strictUniqueSources) {
        throw new Error(`${PROVIDER_API_FAILURE}: Strict jobs require every unique generated clip`);
      }
      videoBuffer = await createSimulationClip(10);
      thumbnailBuffer = await extractVideoThumbnail(videoBuffer, 2);
    }
    supervisor.throwIfAborted();
    logger.info({ jobId: job.id, clipCount: clips.length }, "Stitching completed");

    await updateJobStatus(job.id, { progressPercent: 88 });
    supervisor.throwIfAborted();

    // === STORING ===
    const videoId = randomUUID();
    logger.info({ jobId: job.id, videoId }, "Uploading video and thumbnail");

    supervisor.throwIfAborted();
    logger.info({ jobId: job.id, videoId }, "Master upload started");
    const videoObjectPath = await storageService.uploadVideoBuffer(videoBuffer, videoId);
    logger.info({ jobId: job.id, videoId }, "Master upload completed");

    supervisor.throwIfAborted();
    logger.info({ jobId: job.id, videoId }, "Thumbnail upload started");
    const thumbnailObjectPath = await storageService.uploadThumbnailBuffer(thumbnailBuffer, videoId);
    logger.info({ jobId: job.id, videoId }, "Thumbnail upload completed");

    supervisor.throwIfAborted();
    logger.info({ jobId: job.id, videoId }, "Preview creation and upload started");
    const previewObjectPath = await createAndUploadWebPreview(
      videoBuffer,
      videoId,
      outputDuration,
      supervisor.signal,
    );
    logger.info({ jobId: job.id, videoId }, "Preview creation and upload completed");

    // Persist individual clips so the user can remix (regenerate) any one of
    // them later without rerunning the whole pipeline.
    supervisor.throwIfAborted();
    logger.info({ jobId: job.id, videoId, clipCount: clips.length }, "Clip persistence started");
    const clipMetas = await persistClips(
      videoId,
      clips,
      job.style ?? null,
      resolvedSequence,
      outputDuration,
      supervisor.signal,
    );
    supervisor.throwIfAborted();
    logger.info({ jobId: job.id, videoId, clipCount: clips.length }, "Clip persistence completed");

    supervisor.throwIfAborted();
    const activatedLipSyncChildId = await db.transaction(async (tx) => {
      const [parentState] = await tx
        .select({
          status: jobsTable.status,
          claimedAt: jobsTable.claimedAt,
          manifest: jobsTable.manifest,
        })
        .from(jobsTable)
        .where(eq(jobsTable.id, job.id))
        .limit(1)
        .for("update");
      const parentMeta =
        parentState?.manifest && typeof parentState.manifest === "object"
          ? (parentState.manifest as AiJobMeta)
          : aiMetaOf(job);
      const ours = job.claimedAt ? new Date(job.claimedAt).getTime() : null;
      const current = parentState?.claimedAt ? new Date(parentState.claimedAt).getTime() : null;
      const isCompleteSavedClipRecovery =
        parentMeta.completeSavedClipRecovery === true &&
        hasCompleteSavedClipSet(
          parentMeta.partialClips ?? {},
          parentMeta.storyboard?.numClips ?? 0,
        );
      if (
        !parentState ||
        parentState.status !== "stitching" ||
        ours === null ||
        ours !== current ||
        (parentMeta.refunded && !isCompleteSavedClipRecovery)
      ) {
        throw new Error(`${OWNERSHIP_LOST} (source finalization fence)`);
      }

      await tx.insert(videosTable).values({
        id: videoId,
        userId: job.userId,
        jobId: job.id,
        videoObjectPath,
        previewObjectPath,
        thumbnailObjectPath,
        title: job.prompt ? job.prompt.slice(0, 100) : "Generated Video",
        durationSeconds: outputDuration,
        style: job.style,
        prompt: job.prompt,
        clips: clipMetas as unknown as Record<string, unknown>,
        shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
        hasAudio: !!audioData,
      });
      if (!isCompleteSavedClipRecovery) {
        await tx
          .update(creditsTable)
          .set({
            totalGenerations: sql`total_generations + 1`,
            updatedAt: new Date(),
          })
          .where(eq(creditsTable.userId, job.userId));
      }
      let nextParentMeta = parentMeta;
      let childId: string | null = null;
      if (
        !isCompleteSavedClipRecovery &&
        parentMeta.bundledLipSyncEnabled &&
        parentMeta.bundledLipSyncChildId &&
        !parentMeta.bundledLipSyncActivated
      ) {
        childId = parentMeta.bundledLipSyncChildId;
        const [childState] = await tx
          .select({ status: jobsTable.status, manifest: jobsTable.manifest })
          .from(jobsTable)
          .where(eq(jobsTable.id, childId))
          .limit(1)
          .for("update");
        if (!childState || childState.status !== "pending_approval") {
          throw new Error("Bundled AI Lip Sync child is unavailable; refusing to transfer its reservation.");
        }
        const childMeta =
          childState?.manifest && typeof childState.manifest === "object"
            ? (childState.manifest as AiJobMeta)
            : {};
        await tx
          .update(jobsTable)
          .set({
            status: "queued",
            progressPercent: 0,
            errorMessage: null,
            manifest: {
              ...childMeta,
              reservedCredits: parentMeta.bundledLipSyncCost ?? 0,
              reservedSubscriptionCredits:
                parentMeta.bundledLipSyncReservedSubscriptionCredits ?? 0,
              reservedTopupCredits: parentMeta.bundledLipSyncReservedTopupCredits ?? 0,
            } as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          })
          .where(eq(jobsTable.id, childId));
        nextParentMeta = {
          ...parentMeta,
          reservedCredits: parentMeta.baseCreditCost ?? parentMeta.reservedCredits ?? 0,
          reservedSubscriptionCredits: parentMeta.baseReservedSubscriptionCredits ?? 0,
          reservedTopupCredits: parentMeta.baseReservedTopupCredits ?? 0,
          bundledLipSyncActivated: true,
        };
      }
      await tx
        .update(jobsTable)
        .set({
          status: "ready",
          progressPercent: 100,
          videoId,
          manifest: nextParentMeta as unknown as Record<string, unknown>,
          errorMessage: shortfallNotice ?? null,
          claimedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(jobsTable.id, job.id));
      return childId;
    });

    // Credits were RESERVED (charged) up front when the job was created, so we
    // do NOT deduct again here. For a bundle, the transaction above moves only
    // the Lip Sync portion to the waiting child before it becomes claimable.
    await cleanupPartialClips(job.id).catch(() => {});
    logger.info(
      { jobId: job.id, userId: job.userId, reserved: aiMetaOf(job).reservedCredits ?? 0 },
      "Generation complete — credits were reserved up front",
    );

    await notifyJobUpdate(job.id);
    if (activatedLipSyncChildId) await notifyJobUpdate(activatedLipSyncChildId);
    void notifyRenderReady(job);
    logger.info({ jobId: job.id, videoId, provider: getActiveProvider() }, "Job completed");
  } catch (err) {
    await retryOrFail(job, err);
  }
}

async function processJob(job: JobRow): Promise<void> {
  const supervisor = createJobRunSupervisor({
    assertOwned: () => assertJobOwned(job),
    isOwnershipLost: (error) =>
      error instanceof Error && error.message.includes(OWNERSHIP_LOST),
    ownershipIntervalMs: 10_000,
    assemblyDeadlineMs: 60 * 60_000,
  });
  try {
    return await runWithResourceLeaseExecutionContext({
      jobId: job.id,
      heartbeat: () => assertJobOwned(job),
      shouldAbort: () => processorState.state === "draining" || processorState.state === "stopped",
      signal: supervisor.signal,
    }, () => processJobInner(job, supervisor));
  } finally {
    supervisor.stop();
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
    //
    // A watchdog re-queue is a retry attempt like any other, and each attempt
    // incurs real provider spend — so it must be PAID for. Jobs whose owner
    // can't cover another attempt are failed permanently instead of re-queued.
    // Image requests may be billable at provider submission. Do not ever
    // auto-requeue a stale image pack: we cannot prove that an interrupted
    // provider request did not finish. Fail it and return only the unused
    // portion of its one-time reservation.
    const staleImagePacks = await db
      .select()
      .from(jobsTable)
      .where(sql`
        status IN ('analyzing', 'generating', 'stitching')
        AND job_type = 'image_pack'
        AND ${staleWindow}
        ${notInFlight}
      `);
    for (const imagePack of staleImagePacks) {
      const imagePackMeta = aiMetaOf(imagePack);
      const pollRecovery = planNoChargePollRecovery(imagePackMeta, true);
      if (
        Object.keys(imagePackMeta.pendingImageRequests ?? {}).length > 0
        && pollRecovery.canRetry
      ) {
        const requeued = await requeueSavedPollAtNoCharge(
          imagePack.id,
          imagePack.claimedAt,
          "image",
          `Image polling timed out. Safely resuming the saved request at no charge (${pollRecovery.nextCount}/${MAX_NO_CHARGE_POLL_RECOVERIES}).`,
          Date.now() + 60_000,
        );
        if (requeued) {
          logger.info({ jobId: imagePack.id }, "Watchdog resumed image pack from saved request");
          await notifyJobUpdate(imagePack.id);
          continue;
        }
      }
      const failed = await db.execute<{ id: string }>(sql`
        UPDATE jobs
        SET status = 'failed', claimed_at = NULL,
            error_message = 'Image pack stopped without a confirmed provider result.',
            updated_at = NOW()
        WHERE id = ${imagePack.id}
          AND status IN ('analyzing', 'generating', 'stitching')
          AND job_type = 'image_pack'
          AND claimed_at = ${imagePack.claimedAt}
          AND ${staleWindow}
        RETURNING id
      `);
      if (failed.rows.length > 0) {
        const refunded = await refundImagePackRemainder(imagePack);
        await updateJobStatus(imagePack.id, {
          errorMessage: `Image pack stopped without a confirmed provider result. ${refunded > 0 ? "Credits for images that were not created were returned." : ""}`.trim(),
        });
        void notifyAdminRenderFailed(imagePack, "Image pack stopped without a confirmed provider result.");
        await notifyJobUpdate(imagePack.id);
      }
    }

    const staleImageFirstPollJobs = await db
      .select()
      .from(jobsTable)
      .where(sql`
        status IN ('analyzing', 'generating', 'stitching')
        AND manifest->>'imageFirstVersion' = '1'
        AND ${staleWindow}
        ${notInFlight}
        AND (
          EXISTS (
            SELECT 1 FROM jsonb_object_keys(COALESCE(manifest->'pendingImageRequests', '{}'::jsonb))
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_object_keys(COALESCE(manifest->'pendingRequests', '{}'::jsonb))
          )
        )
      `);
    for (const candidate of staleImageFirstPollJobs) {
      const meta = aiMetaOf(candidate);
      const imageTimeout = Object.keys(meta.pendingImageRequests ?? {}).length > 0;
      const pollRecovery = planNoChargePollRecovery(meta, imageTimeout);
      if (!pollRecovery.canRetry) continue;
      const requeued = await requeueSavedPollAtNoCharge(
        candidate.id,
        candidate.claimedAt,
        imageTimeout ? "image" : "provider",
        `A saved image or scene request timed out. Resuming it at no charge (${pollRecovery.nextCount}/${MAX_NO_CHARGE_POLL_RECOVERIES}).`,
        Date.now() + 60_000,
      );
      if (requeued) {
        logger.info({ jobId: candidate.id }, "Watchdog resumed stale image-first saved request");
        await notifyJobUpdate(candidate.id);
      }
    }

    // A request-free image-first job is safe to resume once every planned
    // source image exists. This path performs only assembly or fresh,
    // reservation-backed scene work and does not consume a polling recovery.
    const safeImageFirstRecovery = sql`(
      NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(
          COALESCE(manifest->'uncertainImageSubmissions', '{}'::jsonb)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(
          COALESCE(manifest->'imageSubmissionIntents', '{}'::jsonb)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(
          COALESCE(manifest->'uncertainSubmissions', '{}'::jsonb)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(
          COALESCE(manifest->'submissionIntents', '{}'::jsonb)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(
          COALESCE(manifest->'pendingImageRequests', '{}'::jsonb)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_object_keys(
          COALESCE(manifest->'pendingRequests', '{}'::jsonb)
        )
      )
      AND jsonb_array_length(COALESCE(manifest->'storyboard'->'shots', '[]'::jsonb)) > 0
      AND (
        SELECT COUNT(*) FROM image_assets
        WHERE image_assets.job_id = jobs.id
      ) >= jsonb_array_length(COALESCE(manifest->'storyboard'->'shots', '[]'::jsonb))
    )`;
    const recoveredImageFirstJobs = await db.execute<{ id: string }>(sql`
      UPDATE jobs
      SET status = 'queued', claimed_at = NULL,
          error_message = 'A saved image or scene request timed out. Resuming it without a new provider submission or credit charge.',
          manifest = COALESCE(manifest, '{}'::jsonb) || jsonb_build_object(
            'retryAfter', ${(Date.now() + 60_000)}::bigint,
            'finalizeWithPartial', false
          ),
          updated_at = NOW()
      WHERE status IN ('analyzing', 'generating', 'stitching')
        AND manifest->>'imageFirstVersion' = '1'
        AND retry_count < ${MAX_RETRIES - 1}
        AND ${staleWindow}
        ${notInFlight}
        AND ${safeImageFirstRecovery}
      RETURNING id
    `);
    for (const row of recoveredImageFirstJobs.rows) {
      logger.info({ jobId: row.id }, "Watchdog resumed stale image-first job from saved work");
      await notifyJobUpdate(row.id);
    }

    // Unsafe image-first jobs still fail and refund: no complete foundation or
    // durable poll handle means a retry could create a duplicate paid request.
    const staleImageFirstJobs = await db.execute<{ id: string; user_id: string }>(sql`
      UPDATE jobs
      SET status = 'failed', claimed_at = NULL,
          error_message = 'The source-image stage stopped without a confirmed result. Credits for unfinished work were returned and no automatic retry was attempted.',
          updated_at = NOW()
      WHERE status IN ('analyzing', 'generating', 'stitching')
        AND manifest->>'imageFirstVersion' = '1'
        AND claimed_at IS NOT NULL
        AND ${staleWindow}
        ${notInFlight}
        AND (
          NOT ${safeImageFirstRecovery}
          OR retry_count >= ${MAX_RETRIES - 1}
        )
      RETURNING id, user_id
    `);
    for (const row of staleImageFirstJobs.rows) {
      await refundReservation(row.id, row.user_id, "stale-image-foundation");
      void notifyAdminRenderFailed(
        { id: row.id, userId: row.user_id },
        "Source-image recovery stopped without a safe resumable request.",
      );
      await notifyJobUpdate(row.id);
    }

    const staleCandidates = await db.execute<{
      id: string;
      user_id: string;
      manifest: unknown;
      claimed_at: Date | string | null;
    }>(sql`
      SELECT id, user_id, manifest, claimed_at FROM jobs
      WHERE status IN ('analyzing', 'generating', 'stitching')
        AND job_type <> 'image_pack'
        AND COALESCE(manifest->>'imageFirstVersion', '') <> '1'
        AND claimed_at IS NOT NULL
        AND ${staleWindow}
        AND (
          retry_count < ${MAX_RETRIES - 1}
          OR EXISTS (
            SELECT 1 FROM jsonb_object_keys(COALESCE(manifest->'pendingRequests', '{}'::jsonb))
          )
        )
        ${notInFlight}
    `);
    const recovered: string[] = [];
    for (const row of staleCandidates.rows) {
      const meta =
        row.manifest && typeof row.manifest === "object" ? (row.manifest as AiJobMeta) : {};
      if (Object.keys(meta.pendingRequests ?? {}).length > 0) {
        const pollRecovery = planNoChargePollRecovery(meta, false);
        const requeued = pollRecovery.canRetry
          ? await requeueSavedPollAtNoCharge(
              row.id,
              row.claimed_at,
              "provider",
              `Scene polling timed out. Safely resuming the saved request at no charge (${pollRecovery.nextCount}/${MAX_NO_CHARGE_POLL_RECOVERIES}).`,
              Date.now() + 60_000,
            )
          : null;
        if (requeued) {
          recovered.push(row.id);
          continue;
        }
        const stopped = await db.execute<{ id: string }>(sql`
          UPDATE jobs
          SET status = 'failed', claimed_at = NULL,
              error_message = 'The saved scene request could not be resumed safely. Credits for unfinished work were returned.',
              updated_at = NOW()
          WHERE id = ${row.id}
            AND status IN ('analyzing', 'generating', 'stitching')
            AND claimed_at = ${row.claimed_at}
            AND ${staleWindow}
          RETURNING id
        `);
        if (stopped.rows.length > 0) {
          await refundReservation(row.id, row.user_id, "saved-poll-recovery-stopped");
          void notifyAdminRenderFailed(
            { id: row.id, userId: row.user_id },
            "Saved scene polling could not be resumed safely.",
          );
          await notifyJobUpdate(row.id);
        }
        continue;
      }
      // Finalize-only runs never call the provider — watchdog recovery of one
      // must be free. Bundles are also reserved exactly once at creation, so a
      // watchdog recovery must never debit the combined total again.
      const pendingBundle =
        meta.bundledLipSyncEnabled === true && meta.bundledLipSyncActivated !== true;
      const retryCost =
        meta.completeSavedClipRecovery === true || meta.finalizeWithPartial === true || pendingBundle
          ? 0
          : imageFirstAutomaticRetryCost(meta);
      // Charge + re-queue in ONE atomic statement: the target row is locked
      // (FOR UPDATE SKIP LOCKED guards against racing recoveries), the charge
      // only fires when the job is still stale, and the re-queue only fires
      // when the charge succeeded — so a crash or race can never orphan a
      // charge or produce an unpaid retry attempt.
      const requeued = await db.execute<{ id: string }>(sql`
        WITH target AS (
          SELECT id FROM jobs
          WHERE id = ${row.id}
            AND status IN ('analyzing', 'generating', 'stitching')
            AND claimed_at = ${row.claimed_at}
            AND ${staleWindow}
          FOR UPDATE SKIP LOCKED
        ),
        charged AS (
          UPDATE credits SET
            subscription_credits = GREATEST(subscription_credits - ${retryCost}, 0),
            topup_credits = GREATEST(topup_credits - GREATEST(${retryCost} - subscription_credits, 0), 0),
            credits_remaining = credits_remaining - ${retryCost},
            credits_used = credits_used + ${retryCost},
            updated_at = NOW()
          WHERE ${retryCost} > 0 AND user_id = ${row.user_id} AND credits_remaining >= ${retryCost}
            AND EXISTS (SELECT 1 FROM target)
          RETURNING user_id
        )
        UPDATE jobs
        SET
          status    = 'queued',
          claimed_at = NULL,
          error_message = 'Auto-recovered: stuck for >15 min without progress',
          retry_count = retry_count + 1,
          updated_at = NOW()
        WHERE id IN (SELECT id FROM target)
          AND (${retryCost} <= 0 OR EXISTS (SELECT 1 FROM charged))
        RETURNING id
      `);
      if (requeued.rows.length > 0) {
        if (retryCost > 0) {
          logger.info(
            { jobId: row.id, userId: row.user_id, retryCost },
            "Charged credits for watchdog recovery retry",
          );
        }
        recovered.push(row.id);
        continue;
      }
      // 0 rows: the job changed state / is locked (skip silently), OR the owner
      // can't pay for another attempt — fail permanently only in that case.
      if (retryCost > 0) {
        const failed = await db.execute<{ id: string }>(sql`
          UPDATE jobs
          SET status = 'failed', claimed_at = NULL,
              error_message = 'Failed: stuck without progress and not enough credits to retry',
              updated_at = NOW()
          WHERE id = ${row.id}
            AND status IN ('analyzing', 'generating', 'stitching')
            AND claimed_at = ${row.claimed_at}
            AND ${staleWindow}
            AND NOT EXISTS (
              SELECT 1 FROM credits
              WHERE user_id = ${row.user_id} AND credits_remaining >= ${retryCost}
            )
          RETURNING id
        `);
        if (failed.rows.length > 0) {
          logger.warn(
            { jobId: row.id, userId: row.user_id, retryCost },
            "Stale job failed permanently — insufficient credits for recovery retry",
          );
          void notifyAdminRenderFailed(
            { id: row.id, userId: row.user_id },
            "Stale render recovery could not reserve the required retry credits.",
          );
          await notifyJobUpdate(row.id);
        }
      }
    }
    if (recovered.length > 0) {
      logger.warn({ recovered }, "Recovered stale jobs");
      for (const id of recovered) await notifyJobUpdate(id);
    }

    // Stale jobs that have exhausted retries are failed permanently instead of
    // being re-queued — this is the hard stop that prevents endless provider
    // charges for a job that can never finish.
    const exhausted = await db.execute<{ id: string; user_id: string; manifest: unknown }>(sql`
      UPDATE jobs
      SET
        status    = 'failed',
        claimed_at = NULL,
        error_message = 'Failed: stuck repeatedly without progress (max retries reached)',
        updated_at = NOW()
      WHERE status IN ('analyzing', 'generating', 'stitching')
        AND job_type <> 'image_pack'
        AND claimed_at IS NOT NULL
        AND ${staleWindow}
        AND retry_count >= ${MAX_RETRIES - 1}
        ${notInFlight}
      RETURNING id, user_id, manifest
    `);
    if (exhausted.rows.length > 0) {
      logger.error(
        { failed: exhausted.rows.map((r) => r.id) },
        "Stale jobs permanently failed after exhausting retries",
      );
      for (const row of exhausted.rows) {
        const meta =
          row.manifest && typeof row.manifest === "object"
            ? (row.manifest as AiJobMeta)
            : {};
        if (meta.bundledLipSyncEnabled && !meta.bundledLipSyncActivated) {
          await refundReservation(
            row.id,
            row.user_id,
            "bundled-source-watchdog-retries-exhausted",
          );
        }
        void notifyAdminRenderFailed(
          { id: row.id, userId: row.user_id },
          "Render recovery reached its retry limit.",
        );
        await notifyJobUpdate(row.id);
      }
    }
  } catch (err) {
    logger.error({ err }, "Stale job recovery error (non-fatal)");
  }
}

let isRunning = false;
let stopping = false;

function syncProcessorActivity(activeJobId: string | null): void {
  processorState = {
    ...processorState,
    activeJobs: activeJobId ? 1 : 0,
    activeJobIds: activeJobId ? [activeJobId] : [],
  };
}

export function getJobProcessorStatus(): JobProcessorStatus {
  return {
    ...processorState,
    activeJobIds: [...processorState.activeJobIds],
  };
}

export async function getJobProcessorHealth(): Promise<
  JobProcessorStatus & { queue: QueueMetrics }
> {
  let queue: QueueMetrics = {
    queued: 0,
    active: processorState.activeJobs,
    retrying: 0,
    stale: 0,
    oldestQueuedAt: null,
    oldestQueuedAgeMs: null,
    database: "degraded",
  };

  try {
    const result = await db.execute<{
      queued: string;
      active: string;
      retrying: string;
      stale: string;
      oldest_queued_at: Date | string | null;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::text AS queued,
        COUNT(*) FILTER (
          WHERE status IN ('analyzing', 'generating', 'stitching')
        )::text AS active,
        COUNT(*) FILTER (
          WHERE status IN ('queued', 'analyzing', 'generating', 'stitching')
            AND retry_count > 0
        )::text AS retrying,
        COUNT(*) FILTER (
          WHERE status IN ('analyzing', 'generating', 'stitching')
            AND (
              (job_type = 'editor_render' AND updated_at < NOW() - INTERVAL '60 minutes')
              OR (job_type <> 'editor_render' AND updated_at < NOW() - INTERVAL '15 minutes')
            )
        )::text AS stale,
        MIN(created_at) FILTER (WHERE status = 'queued') AS oldest_queued_at
      FROM jobs
    `);
    const row = result.rows[0];
    const oldest = row?.oldest_queued_at
      ? new Date(row.oldest_queued_at)
      : null;
    queue = {
      queued: Number.parseInt(row?.queued ?? "0", 10) || 0,
      active: Number.parseInt(row?.active ?? "0", 10) || 0,
      retrying: Number.parseInt(row?.retrying ?? "0", 10) || 0,
      stale: Number.parseInt(row?.stale ?? "0", 10) || 0,
      oldestQueuedAt: oldest && Number.isFinite(oldest.getTime())
        ? oldest.toISOString()
        : null,
      oldestQueuedAgeMs: oldest && Number.isFinite(oldest.getTime())
        ? Math.max(0, Date.now() - oldest.getTime())
        : null,
      database: "ok",
    };
  } catch (err) {
    logger.warn({ err, workerId: WORKER_ID }, "Worker health queue query failed");
  }

  return {
    ...getJobProcessorStatus(),
    queue,
  };
}

function parseShutdownTimeout(timeoutMs?: number): number {
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Math.min(Math.floor(timeoutMs), 300_000);
  }
  const configured = Number.parseInt(
    process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? "",
    10,
  );
  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, 300_000)
    : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

export async function stopJobProcessor(
  timeoutMs?: number,
): Promise<{ drained: boolean; activeJobIds: string[] }> {
  if (!isRunning && !currentJobPromise) {
    processorState = { ...processorState, state: "stopped" };
    return { drained: true, activeJobIds: [] };
  }

  stopping = true;
  processorState = { ...processorState, state: "draining" };
  if (pollTimer) clearTimeout(pollTimer);
  if (recoveryTimer) clearInterval(recoveryTimer);
  if (metricsTimer) clearInterval(metricsTimer);
  pollTimer = null;
  recoveryTimer = null;
  metricsTimer = null;

  if (pollInFlight) {
    await pollInFlight.catch((err) => {
      logger.warn({ err, workerId: WORKER_ID }, "Worker poll failed while draining");
    });
  }

  const activeJobIds = [...processorState.activeJobIds];
  const active = currentJobPromise;
  if (!active) {
    isRunning = false;
    processorState = { ...processorState, state: "stopped" };
    return { drained: true, activeJobIds };
  }

  const timeout = parseShutdownTimeout(timeoutMs);
  let timer: NodeJS.Timeout | null = null;
  const drained = await Promise.race([
    active.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeout);
      timer.unref();
    }),
  ]);
  if (timer) clearTimeout(timer);

  if (drained) {
    isRunning = false;
    processorState = { ...processorState, state: "stopped" };
  }
  return {
    drained,
    activeJobIds: drained ? [] : [...processorState.activeJobIds],
  };
}

export async function startJobProcessor(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  stopping = false;
  processorState = {
    ...processorState,
    state: "starting",
    startedAt: new Date().toISOString(),
  };
  logger.info(
    { workerId: WORKER_ID, capacity: WORKER_CAPACITY },
    "Job processor started",
  );

  // Run stale-job recovery immediately on startup (catches jobs stuck across
  // a deployment restart), then on a regular interval.
  void recoverStaleJobs();
  recoveryTimer = setInterval(
    () => void recoverStaleJobs(),
    STALE_CHECK_INTERVAL_MS,
  );
  recoveryTimer.unref();
  metricsTimer = setInterval(() => {
    void getJobProcessorHealth().then((health) => {
      if (
        health.queue.queued > 0 ||
        health.queue.active > 0 ||
        health.queue.database !== "ok"
      ) {
        logger.info(
          {
            workerId: health.workerId,
            state: health.state,
            capacity: health.capacity,
            activeJobs: health.activeJobs,
            queuedJobs: health.queue.queued,
            totalActiveJobs: health.queue.active,
            retryingJobs: health.queue.retrying,
            staleJobs: health.queue.stale,
            oldestQueuedAgeMs: health.queue.oldestQueuedAgeMs,
            database: health.queue.database,
          },
          "Worker capacity snapshot",
        );
      }
    });
  }, WORKER_METRICS_INTERVAL_MS);
  metricsTimer.unref();

  // Only one job at a time per process: renders run heavy ffmpeg pipelines,
  // and two concurrent renders can exhaust memory and crash the whole server
  // (which re-queues both jobs and repeats the crash loop). Claiming is
  // skipped while a job is in flight; independent worker processes still pick
  // up queued jobs via FOR UPDATE SKIP LOCKED.
  const poll = async (): Promise<void> => {
    if (!processorBusy && !stopping) {
      try {
        const job = await claimNextJob();
        if (job) {
          if (stopping) {
            await releaseUnstartedClaim(job);
            return;
          }
          processorBusy = true;
          processorState = {
            ...processorState,
            state: "ready",
            jobsStarted: processorState.jobsStarted + 1,
          };
          syncProcessorActivity(job.id);
          inFlightJobIds.add(job.id);
          if (job.claimedAt) activeClaimTokens.set(job.id, new Date(job.claimedAt));
          const stopHeartbeat = startJobHeartbeat(job);
          currentJobPromise = processJob(job)
            .then(() => {
              processorState = {
                ...processorState,
                jobsCompleted: processorState.jobsCompleted + 1,
              };
            })
            .catch((err) => {
              processorState = {
                ...processorState,
                jobsFailed: processorState.jobsFailed + 1,
              };
              logger.error({ err, jobId: job.id }, "Unhandled job error");
            })
            .finally(() => {
              stopHeartbeat();
              inFlightJobIds.delete(job.id);
              activeClaimTokens.delete(job.id);
              processorBusy = false;
              currentJobPromise = null;
              syncProcessorActivity(null);
              if (stopping) {
                isRunning = false;
                processorState = { ...processorState, state: "stopped" };
              }
            });
        } else if (processorState.state === "starting") {
          processorState = { ...processorState, state: "ready" };
        }
      } catch (err) {
        logger.error({ err }, "Poll error");
      }
    }
    if (!stopping) {
      pollTimer = setTimeout(() => void runPoll(), POLL_INTERVAL_MS);
    }
  };

  const runPoll = (): Promise<void> => {
    const run = poll();
    pollInFlight = run;
    return run.finally(() => {
      if (pollInFlight === run) pollInFlight = null;
    });
  };

  await runPoll();
}
