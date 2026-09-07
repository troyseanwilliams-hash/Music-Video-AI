import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { and, eq, sql } from "drizzle-orm";
import { creditsTable, db, jobsTable, withResourceLease } from "@workspace/db";
import { analyzeAudioBuffer } from "./audioAnalysis.js";
import { signAudioAnalysisReceipt } from "./audioAnalysisReceipt.js";
import {
  ConclusiveNarrationError,
  narrationUsesExistingMusic,
  synthesizeMusic,
  synthesizeNarration,
  type NarrationMusicSource,
} from "./narration.js";
import { ObjectStorageService } from "./objectStorage.js";
import { notifyAdminRenderFailed } from "./renderEmail.js";

const execFileAsync = promisify(execFile);
const storage = new ObjectStorageService();
type Job = typeof jobsTable.$inferSelect;
type Meta = {
  script: string;
  voiceId: string;
  includeMusic?: boolean;
  musicSource?: NarrationMusicSource;
  musicPrompt?: string;
  musicObjectPath?: string;
  musicTitle?: string;
  stage?: string;
  idempotencyKey?: string;
  chargedCredits: number;
  chargedSubscriptionCredits: number;
  chargedTopupCredits: number;
  refunded?: boolean;
  narrationRequestId?: string | null;
  musicRequestId?: string | null;
  acceptedOutputPath?: string;
};

function metaOf(job: Job): Meta {
  return job.manifest as Meta;
}

export function narrationRefundSplit(meta: Pick<Meta, "chargedSubscriptionCredits" | "chargedTopupCredits">) {
  const subscription = Math.max(0, meta.chargedSubscriptionCredits ?? 0);
  const topup = Math.max(0, meta.chargedTopupCredits ?? 0);
  return { subscription, topup, total: subscription + topup };
}

async function updateOwned(job: Job, values: Partial<typeof jobsTable.$inferInsert>): Promise<void> {
  const changed = await db.update(jobsTable).set({ ...values, updatedAt: new Date() }).where(and(
    eq(jobsTable.id, job.id),
    eq(jobsTable.claimedAt, job.claimedAt!),
  )).returning({ id: jobsTable.id });
  if (!changed.length) throw new Error("Narration job claim was lost");
}

async function checkpoint(job: Job, meta: Meta, stage: string, extra: Partial<Meta> = {}): Promise<Meta> {
  const next = { ...meta, ...extra, stage };
  await updateOwned(job, { manifest: next as unknown as Record<string, unknown> });
  return next;
}

export async function refundNarrationOnce(jobId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1).for("update");
    if (!job || job.jobType !== "narration") return 0;
    const meta = metaOf(job);
    if (meta.refunded || meta.chargedCredits <= 0 || job.status === "ready") return 0;
    const { subscription, topup, total } = narrationRefundSplit(meta);
    await tx.update(creditsTable).set({
      subscriptionCredits: sql`subscription_credits + ${subscription}`,
      topupCredits: sql`topup_credits + ${topup}`,
      creditsRemaining: sql`credits_remaining + ${total}`,
      creditsUsed: sql`GREATEST(credits_used - ${total}, 0)`,
      updatedAt: new Date(),
    }).where(eq(creditsTable.userId, job.userId));
    await tx.update(jobsTable).set({
      manifest: { ...meta, refunded: true } as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    }).where(eq(jobsTable.id, job.id));
    return total;
  });
}

function customerFailure(uncertain: boolean): string {
  return uncertain
    ? "Narration may have been submitted, but confirmation was interrupted. We stopped safely to prevent a duplicate charge. Please contact support."
    : "Narration could not be completed. Your narration credits were restored.";
}

export function isUncertainNarrationSubmission(stage: string | undefined, error: unknown): boolean {
  return !(error instanceof ConclusiveNarrationError) && (
    stage?.endsWith("_submission_intent") === true
    || stage?.endsWith("_submission_uncertain") === true
    || stage === "tts_accepted"
    || stage === "music_accepted"
    || (error instanceof Error && error.message === "UNCERTAIN_SUBMISSION")
  );
}

export async function processNarrationJob(job: Job): Promise<void> {
  let meta = metaOf(job);
  const dir = join(tmpdir(), `aibeatsync-narration-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  let uploadedPath: string | null = null;
  try {
    if (meta.stage === "complete" && meta.acceptedOutputPath) {
      const buffer = await storage.downloadObjectBuffer(meta.acceptedOutputPath);
      const analysis = await analyzeAudioBuffer(buffer, "mp3");
      await updateOwned(job, {
        status: "ready",
        progressPercent: 100,
        audioObjectPath: meta.acceptedOutputPath,
        audioSourceType: "upload",
        audioAnalysis: {
          ...analysis,
          analysisReceipt: signAudioAnalysisReceipt({
            userId: job.userId,
            objectPath: meta.acceptedOutputPath,
            analysis,
          }),
        },
        claimedAt: null,
        errorMessage: null,
      });
      return;
    }
    if (meta.stage === "tts_submission_intent" || meta.stage === "tts_submission_uncertain"
      || meta.stage === "tts_accepted" || meta.stage === "music_submission_intent"
      || meta.stage === "music_submission_uncertain" || meta.stage === "music_accepted") {
      throw new Error("UNCERTAIN_SUBMISSION");
    }
    await updateOwned(job, { status: "analyzing", progressPercent: 5, errorMessage: null });
    meta = await checkpoint(job, meta, "tts_submission_intent");
    const narration = await synthesizeNarration(meta.script, meta.voiceId, job.id);
    meta = await checkpoint(job, meta, "tts_accepted", { narrationRequestId: narration.requestId });
    await writeFile(join(dir, "narration.mp3"), narration.buffer);
    let output = join(dir, "narration.mp3");

    const musicSource = meta.musicSource ?? (meta.includeMusic ? "generated" : "none");
    if (musicSource !== "none") {
      if (musicSource === "generated") {
        meta = await checkpoint(job, meta, "music_submission_intent");
        const music = await synthesizeMusic(
          meta.musicPrompt || "Subtle cinematic instrumental underscore, no vocals, supportive of spoken narration",
          job.id,
        );
        meta = await checkpoint(job, meta, "music_accepted", { musicRequestId: music.requestId });
        await writeFile(join(dir, "music.mp3"), music.buffer);
      } else if (narrationUsesExistingMusic(musicSource) && meta.musicObjectPath) {
        // downloadObjectToFile releases its storage lease before ffmpeg is acquired.
        await storage.downloadObjectToFile(meta.musicObjectPath, join(dir, "music.mp3"));
      } else {
        throw new Error("Selected narration music is unavailable");
      }
      output = join(dir, "master.mp3");
      await updateOwned(job, { status: "generating", progressPercent: 65 });
      await withResourceLease("ffmpeg_light", ({ signal }) => execFileAsync("ffmpeg", [
        "-y", "-i", join(dir, "narration.mp3"), "-stream_loop", "-1", "-i", join(dir, "music.mp3"),
        "-filter_complex",
        "[1:a]volume=0.12[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11[a]",
        "-map", "[a]", "-c:a", "libmp3lame", "-b:a", "192k", output,
      ], { timeout: 15 * 60_000, signal }), { jobId: job.id, ttlMs: 10 * 60_000 });
    }

    await updateOwned(job, { status: "stitching", progressPercent: 85 });
    const buffer = await readFile(output);
    uploadedPath = await storage.uploadAudioBuffer(buffer, job.id, "mp3", job.userId);
    const analysis = await analyzeAudioBuffer(buffer, "mp3");
    const audioAnalysis = {
      ...analysis,
      analysisReceipt: signAudioAnalysisReceipt({ userId: job.userId, objectPath: uploadedPath, analysis }),
    };
    meta = await checkpoint(job, meta, "complete", { acceptedOutputPath: uploadedPath });
    await updateOwned(job, {
      status: "ready",
      progressPercent: 100,
      audioObjectPath: uploadedPath,
      audioSourceType: "upload",
      audioAnalysis,
      claimedAt: null,
      errorMessage: null,
      manifest: meta as unknown as Record<string, unknown>,
    });
  } catch (error) {
    const uncertain = isUncertainNarrationSubmission(meta.stage, error);
    await storage.deleteObject(uploadedPath ?? `/objects/audio/${job.userId}/${job.id}.mp3`).catch(() => {});
    await updateOwned(job, {
      status: "failed",
      claimedAt: null,
      errorMessage: customerFailure(uncertain),
      manifest: { ...meta, stage: uncertain ? "submission_uncertain" : "failed" } as unknown as Record<string, unknown>,
    });
    await refundNarrationOnce(job.id);
    void notifyAdminRenderFailed(
      job,
      error instanceof Error ? error.message : "Narration processing failed.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}