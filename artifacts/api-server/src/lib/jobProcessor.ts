import { db } from "@workspace/db";
import { jobsTable, videosTable, creditsTable } from "@workspace/db";
import type { VideoClipMeta } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getClipPlan, MAX_FULL_SECONDS } from "./creditCost.js";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { logger } from "./logger.js";
import { notifyRenderReady, notifyRenderFailed, notifyAdminRenderFailed } from "./renderEmail.js";
import { ObjectStorageService } from "./objectStorage.js";
import { analyzeAudioBuffer, type AudioAnalysis, type AudioSection } from "./audioAnalysis.js";
import { generateClip, downloadClip, checkPixazoRequest, getActiveProvider, PROVIDER_API_FAILURE, PROVIDER_OUT_OF_CREDITS } from "./videoApis.js";
import { generateLipsync, lipsyncAvailable } from "./lipsync.js";
import { stitchVideoClips, extractVideoThumbnail } from "./videoStitcher.js";
import { stitchEditorTimeline } from "./editorStitcher.js";

const execAsync = promisify(exec);
const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5000;

const storageService = new ObjectStorageService();
type JobRow = typeof jobsTable.$inferSelect;

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

// Extract [startSec, startSec + durationSec) as an audio-only M4A. Re-encoding
// makes embedded MP4 soundtracks and uploaded audio share one provider-safe
// container instead of accidentally forwarding a video stream.
async function extractAudioClip(
  audio: { buffer: Buffer; ext: string },
  startSec: number,
  durationSec: number,
): Promise<{ buffer: Buffer; ext: string }> {
  const id = randomUUID();
  const inputPath = join(tmpdir(), `bv_in_${id}.${audio.ext}`);
  const outputPath = join(tmpdir(), `bv_clip_${id}.m4a`);
  try {
    await writeFile(inputPath, audio.buffer);
    await execAsync(
      `ffmpeg -y -ss ${startSec.toFixed(3)} -t ${durationSec} -i "${inputPath}" -map 0:a:0 -vn -c:a aac -b:a 192k "${outputPath}"`,
      { timeout: 30_000 },
    );
    const { readFile } = await import("fs/promises");
    const clipped = await readFile(outputPath);
    return { buffer: clipped, ext: "m4a" };
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
  prompt: string;
};

type AiJobMeta = {
  reservedCredits?: number;
  reservedSubscriptionCredits?: number;
  reservedTopupCredits?: number;
  refunded?: boolean;
  lipSyncPollUrl?: string;
  partialClips?: Record<string, string>; // clip index -> object storage path
  pendingRequests?: Record<string, string>; // clip index -> provider poll URL (submitted, not yet downloaded)
  retryAfter?: number; // epoch ms — queued job must not be claimed before this
  finalizeWithPartial?: boolean; // admin: stitch whatever clips exist, never call the provider
  storyboard?: { shots?: unknown[] };
  // TEMPORARY, admin-only: call the real Runway API directly instead of via
  // Pixazo. Set by routes/jobs.ts at job creation. See
  // videoApis.ts ClipRequest.preferDirectRunway.
  preferDirectRunway?: boolean;
};

function aiMetaOf(job: JobRow): AiJobMeta {
  const m = (job as JobRow & { manifest?: unknown }).manifest;
  return m && typeof m === "object" ? (m as AiJobMeta) : {};
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

async function readAiMeta(jobId: string): Promise<AiJobMeta> {
  const [row] = await db
    .select({ manifest: jobsTable.manifest })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  return row?.manifest && typeof row.manifest === "object" ? (row.manifest as AiJobMeta) : {};
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

// Record the provider request for a clip the moment it is accepted, so a clip
// that finishes after we stop polling (crash/freeze/deploy) can be fetched on
// the next attempt instead of being regenerated (and paid for) again.
// Atomic jsonb merge — see persistPartialClip.
async function persistPendingRequest(jobId: string, index: number, pollUrl: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(
          COALESCE(manifest, '{}'::jsonb),
          '{pendingRequests}',
          COALESCE(manifest->'pendingRequests', '{}'::jsonb) || ${JSON.stringify({ [index]: pollUrl })}::jsonb
        ),
        updated_at = NOW()
    WHERE id = ${jobId}
  `);
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
    SET status = 'analyzing', claimed_at = NOW(), updated_at = NOW()
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
): Promise<{
  clips: { buffer: Buffer; targetDuration: number; prompt: string }[];
  shortfallNotice?: string;
}> {
  const provider = getActiveProvider((job as JobRow & { aiProvider?: string | null }).aiProvider ?? undefined);
  const requestedDur = (job as JobRow & { requestedDuration?: string | null }).requestedDuration;

  // Use the same clip plan as the credit formula so the number of provider calls
  // matches exactly what was charged.
  const { numClips: maxClips } = getClipPlan(requestedDur, analysis.durationSeconds);
  const storyboardShots = storyboardShotsOf(job);
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
    sections.push(baseSections[i % baseSections.length]!);
  }

  const refImageUrl = await loadReferenceImageUrl(job);

  // Compute the total output duration from the job's requested duration.
  // Do NOT use section.endTime - section.startTime: when audio clipping fails
  // or MP3 headers report the wrong total length, section timestamps reflect
  // the full audio file and each clip gets looped for the entire song duration.
  const totalOutputDuration = targetOutputDuration(requestedDur, analysis.durationSeconds);
  const perClipTargetDuration = Math.max(1, totalOutputDuration / sections.length);

  const clips: { buffer: Buffer; targetDuration: number; prompt: string }[] = new Array(sections.length);

  // Salvage: any clips rendered on a previous attempt are persisted in the job
  // manifest. Reuse them instead of paying to regenerate — a retry only re-runs
  // the clips that actually failed.
  const persisted: Record<string, string> = { ...(aiMetaOf(job).partialClips ?? {}) };
  // Requests that were submitted (and paid for) on a previous attempt but whose
  // results were never downloaded — check the provider before regenerating.
  const pending: Record<string, string> = { ...(aiMetaOf(job).pendingRequests ?? {}) };
  const reuseCount = Object.keys(persisted).length;
  // Admin "finalize with saved clips": reuse stored clips and reclaim any
  // completed pending requests (both free), but NEVER pay for new generation.
  const finalizeOnly = aiMetaOf(job).finalizeWithPartial === true;

  logger.info(
    { jobId: job.id, provider, sectionCount: sections.length, maxClips, reuseCount },
    reuseCount ? "Generating clips per section (resuming — reusing rendered clips)" : "Generating clips per section",
  );

  // 4K clips are expensive, so don't burn a second full-price attempt on them;
  // everything else gets one in-clip retry before the whole job is failed.
  const is4k = ((job as JobRow & { resolution?: string | null }).resolution ?? "").toLowerCase() === "4k";
  const clipAttempts = is4k ? 1 : 2;

  for (let i = 0; i < sections.length; i++) {
    const storyboardShot = storyboardShots.length > 0
      ? storyboardShots[i % storyboardShots.length]!
      : null;
    const section = sections[i]!;
    const targetDuration = perClipTargetDuration;
    const clipDuration = Math.min(Math.max(Math.ceil(targetDuration), 5), 10);

    await onProgress(30 + Math.floor((i / sections.length) * 40));

    // Build the prompt regardless of provider so it can be persisted as clip
    // metadata (and reused as the basis for a future remix of this clip).
    const prompt = storyboardShot?.prompt ?? buildSectionPrompt(job, analysis, section);

    // 1) Reuse a previously-rendered clip if we have one (salvage on retry).
    if (persisted[i]) {
      try {
        const url = await storageService.getObjectEntitySignedUrl(persisted[i]!, 3600);
        const buf = await downloadClip(url);
        clips[i] = { buffer: buf, targetDuration, prompt };
        logger.info({ jobId: job.id, clip: i }, "Reused previously-rendered clip (salvage)");
        continue;
      } catch (e) {
        logger.warn({ jobId: job.id, clip: i, err: e }, "Persisted clip unreadable — regenerating");
        delete persisted[i];
      }
    }

    // 2) A request submitted on a previous attempt may have finished on the
    //    provider after we stopped polling. Fetch it for free before paying to
    //    regenerate.
    if (pending[i]) {
      const check = await checkPixazoRequest(pending[i]!);
      if (check.state === "completed") {
        try {
          const buf = await downloadClip(check.mediaUrl);
          clips[i] = { buffer: buf, targetDuration, prompt };
          try {
            const path = await storageService.uploadClipBuffer(buf, `job-${job.id}`, i);
            persisted[i] = path;
            await persistPartialClip(job.id, i, path); // also clears the pending entry
          } catch (e) {
            logger.warn({ jobId: job.id, clip: i, err: e }, "Could not persist recovered clip (non-fatal)");
          }
          logger.info({ jobId: job.id, clip: i }, "Recovered stranded clip from provider (no new spend)");
          delete pending[i];
          continue;
        } catch (e) {
          logger.warn({ jobId: job.id, clip: i, err: e }, "Stranded clip download failed — regenerating");
        }
      } else if (check.state === "gone") {
        logger.info({ jobId: job.id, clip: i }, "Pending provider request expired/failed — regenerating");
      } else {
        logger.info({ jobId: job.id, clip: i }, "Pending provider request still in flight — regenerating anyway");
      }
      delete pending[i];
      await clearPendingRequest(job.id, i).catch(() => {});
    }

    // 3) Finalize-only mode: never generate new clips — skip anything that
    //    couldn't be reused/reclaimed for free.
    if (finalizeOnly) {
      logger.info({ jobId: job.id, clip: i }, "Finalize-only: skipping missing clip (no new spend)");
      continue;
    }

    // 3b) Simulation fallback (no real provider configured).
    if (provider === "simulation") {
      logger.info({ jobId: job.id, section: section.label, clipDuration }, "Simulation: creating placeholder clip");
      await new Promise((r) => setTimeout(r, 1500));
      clips[i] = { buffer: await createSimulationClip(clipDuration), targetDuration, prompt };
      continue;
    }

    // 4) Generate the clip, retrying THIS clip a couple of times before failing
    //    the whole job — so one flaky clip doesn't waste the ones already made.
    logger.info(
      { jobId: job.id, section: section.label, provider, prompt: prompt.slice(0, 80) },
      "Generating AI clip",
    );
    let clipBuffer: Buffer | null = null;
    let clipErr: unknown;
    for (let attempt = 1; attempt <= clipAttempts; attempt++) {
      await assertJobOwned(job);
      try {
        const result = await generateClip({
          prompt,
          durationSeconds: clipDuration,
          aspectRatio: job.aspectRatio ?? "16:9",
          imageUrl: refImageUrl ?? undefined,
          // Pin the user's chosen engine (so "Kling" actually renders on Kling)
          // and pass resolution so Kling selects the right model tier / output.
          provider,
          resolution: (job as JobRow & { resolution?: string | null }).resolution,
          // TEMPORARY, admin-only — see AiJobMeta.preferDirectRunway.
          preferDirectRunway: aiMetaOf(job).preferDirectRunway === true,
          // Persist the provider request id before polling starts so this clip
          // is recoverable if the server dies mid-poll.
          onSubmit: (info) => persistPendingRequest(job.id, i, info.pollUrl),
        });
        clipBuffer = result ? await downloadClip(result.videoUrl) : await createSimulationClip(clipDuration);
        if (result) {
          logger.info({ jobId: job.id, section: section.label, provider: result.provider }, "AI clip downloaded");
        }
        break;
      } catch (e) {
        clipErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        // Provider ran out of tokens (Pixazo 402 / quota / balance): if we
        // already have rendered clips, stop generating and salvage them —
        // the video is finished with fewer unique clips (looped to fill the
        // runtime) instead of throwing the whole job away.
        if (msg.includes(PROVIDER_OUT_OF_CREDITS)) {
          const done = clips.filter(Boolean).length;
          if (done > 0) {
            logger.warn(
              { jobId: job.id, clip: i, done, planned: sections.length },
              "Provider out of tokens — stopping generation and salvaging rendered clips",
            );
            const salvaged = clips.filter(Boolean);
            return {
              clips: salvaged,
              shortfallNotice: "Out of tokens",
            };
          }
          throw e; // nothing rendered yet → normal provider-failure path
        }
        if (msg.includes(PROVIDER_API_FAILURE) || /moderation|content policy|safety system/i.test(msg)) throw e;
        if (attempt < clipAttempts) {
          logger.warn({ jobId: job.id, clip: i, attempt }, "Clip attempt failed — retrying this clip");
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    if (!clipBuffer) throw clipErr ?? new Error(`Clip ${i} failed to render`);

    // 5) Persist the successful clip so a future job retry can reuse it.
    try {
      const path = await storageService.uploadClipBuffer(clipBuffer, `job-${job.id}`, i);
      persisted[i] = path;
      await persistPartialClip(job.id, i, path);
    } catch (e) {
      logger.warn({ jobId: job.id, clip: i, err: e }, "Could not persist salvage copy of clip (non-fatal)");
    }

    clips[i] = { buffer: clipBuffer, targetDuration, prompt };
  }

  if (finalizeOnly) {
    const salvaged = clips.filter(Boolean);
    if (salvaged.length === 0) {
      throw new Error(`${PROVIDER_API_FAILURE}: Finalize requested but no rendered clips are available for this job`);
    }
    if (salvaged.length < sections.length) {
      logger.warn(
        { jobId: job.id, salvaged: salvaged.length, planned: sections.length },
        "Finalize-only: stitching with fewer unique clips than planned",
      );
      // Re-spread the requested runtime across the clips we actually have so
      // the stitched video still fills the full duration (clips loop/stretch)
      // instead of ending early.
      const perClip = Math.max(1, totalOutputDuration / salvaged.length);
      return {
        clips: salvaged.map((c) => ({ ...c, targetDuration: perClip })),
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
    void notifyRenderFailed(job, "The AI provider's content policy rejected the prompt.");
    return;
  }

  // AI provider API failures (Kling/Pixazo) are never retried — charges happen
  // at submission time, so re-queuing only causes additional billing with no
  // guarantee of a different outcome.
  if (errMsg.includes(PROVIDER_API_FAILURE)) {
    const cleanMsg = errMsg.replace(PROVIDER_API_FAILURE, "").trim();
    logger.warn({ jobId: job.id }, "Permanent failure: AI provider error — not retrying to avoid repeated charges");
    // Do NOT auto-refund. Keep the reservation and alert the admin to attempt a
    // fix/recovery (re-run failed clips, finalize from partials, or refund
    // manually). Partial clips are retained so recovery is possible.
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: cleanMsg,
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
      liveMeta.finalizeWithPartial === true ||
      (savedClipCount > 0 && /ffmpeg|stitch|video processing/i.test(errMsg));
    const retryCost = assemblyOnlyRetry ? 0 : (liveMeta.reservedCredits ?? 0);
    const delayMs = Math.pow(2, nextRetry) * 60_000;
    const retryAfter = Date.now() + delayMs;
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
        progress_percent = 0,
        error_message = ${noteMsg},
        retry_count = ${nextRetry},
        claimed_at = NULL,
        manifest = COALESCE(manifest, '{}'::jsonb) || jsonb_build_object(
          'retryAfter', ${retryAfter}::bigint,
          'finalizeWithPartial', ${assemblyOnlyRetry}
        ),
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
        void notifyRenderFailed(job, errMsg);
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
    await updateJobStatus(job.id, {
      status: "failed",
      errorMessage: `${errMsg} (max ${maxRetries} ${maxRetries === 1 ? "attempt" : "retries"} reached)`,
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
        const file = await storageService.getObjectEntityFile(s.objectPath);
        const [buf] = await file.download();
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
        const file = await storageService.getObjectEntityFile(manifest.music.objectPath);
        const [buf] = await file.download();
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
    const [videoObjectPath, thumbnailObjectPath] = await Promise.all([
      storageService.uploadVideoBuffer(videoBuffer, videoId),
      storageService.uploadThumbnailBuffer(thumbnailBuffer, videoId),
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

async function processJob(job: JobRow): Promise<void> {
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
    const { clips, shortfallNotice } = await generateClips(job, analysis, (pct) =>
      updateJobStatus(job.id, { progressPercent: pct }),
    );

    await updateJobStatus(job.id, { status: "stitching", progressPercent: 75 });

    // === STITCHING ===
    logger.info({ jobId: job.id, clipCount: clips.length }, "Stitching clips with audio");

    const lyricsText = (job as JobRow & { lyricsText?: string | null }).lyricsText ?? undefined;

    let videoBuffer: Buffer;
    let thumbnailBuffer: Buffer;

    const reqDur = (job as JobRow & { requestedDuration?: string | null }).requestedDuration;
    const outputDuration = targetOutputDuration(reqDur, analysis.durationSeconds);
    if (audioData) {
      const stitchResult = await stitchVideoClips({
        clips,
        audioBuffer: audioData.buffer,
        audioExt: audioData.ext,
        totalDuration: outputDuration,
        lyricsText,
      });
      videoBuffer = stitchResult.videoBuffer;
      thumbnailBuffer = stitchResult.thumbnailBuffer;
    } else if (clips.length > 0) {
      // No audio — either the user intentionally chose "no audio" (a silent
      // video meant to get a soundtrack added later in the Editor), or audio
      // couldn't be loaded. Either way, stitch every generated clip into one
      // silent video rather than discarding all but the first clip.
      const stitchResult = await stitchVideoClips({
        clips,
        totalDuration: outputDuration,
        lyricsText, // captions burn onto silent videos too
      });
      videoBuffer = stitchResult.videoBuffer;
      thumbnailBuffer = stitchResult.thumbnailBuffer;
    } else {
      videoBuffer = await createSimulationClip(10);
      thumbnailBuffer = await extractVideoThumbnail(videoBuffer, 2);
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
      durationSeconds: outputDuration,
      style: job.style,
      prompt: job.prompt,
      clips: clipMetas as unknown as Record<string, unknown>,
      shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
      hasAudio: !!audioData,
    });

    // Credits were RESERVED (charged) up front when the job was created, so we
    // do NOT deduct again here — the old deduct-on-success path both risked a
    // double charge and, worse, leaked real provider spend on failed/partial
    // jobs that never reached this point. Just record the successful generation
    // and drop the salvage copies now that the final video is stored.
    await db
      .update(creditsTable)
      .set({
        totalGenerations: sql`total_generations + 1`,
        updatedAt: new Date(),
      })
      .where(eq(creditsTable.userId, job.userId));
    await cleanupPartialClips(job.id).catch(() => {});
    logger.info(
      { jobId: job.id, userId: job.userId, reserved: aiMetaOf(job).reservedCredits ?? 0 },
      "Generation complete — credits were reserved up front",
    );

    await updateJobStatus(job.id, {
      status: "ready",
      progressPercent: 100,
      videoId,
      // Surface a partial-generation notice (provider ran out of tokens) on
      // the finished job so the user knows why fewer unique clips appear.
      ...(shortfallNotice ? { errorMessage: shortfallNotice } : {}),
    });
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
    //
    // A watchdog re-queue is a retry attempt like any other, and each attempt
    // incurs real provider spend — so it must be PAID for. Jobs whose owner
    // can't cover another attempt are failed permanently instead of re-queued.
    const staleCandidates = await db.execute<{
      id: string;
      user_id: string;
      manifest: unknown;
    }>(sql`
      SELECT id, user_id, manifest FROM jobs
      WHERE status IN ('analyzing', 'generating', 'stitching')
        AND ${staleWindow}
        AND retry_count < ${MAX_RETRIES - 1}
        ${notInFlight}
    `);
    const recovered: string[] = [];
    for (const row of staleCandidates.rows) {
      const meta =
        row.manifest && typeof row.manifest === "object" ? (row.manifest as AiJobMeta) : {};
      // Finalize-only runs never call the provider — watchdog recovery of one
      // must be free.
      const retryCost = meta.finalizeWithPartial === true ? 0 : (meta.reservedCredits ?? 0);
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
          progress_percent = 0,
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
