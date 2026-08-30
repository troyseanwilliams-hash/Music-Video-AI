import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, usersTable, creditsTable, imageAssetsTable } from "@workspace/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { notifyRequestedAdminRenderReady } from "../lib/renderEmail.js";
import {
  clipContentHash,
  securelyDownloadTrustedClip,
  validateClipAttachment,
} from "../lib/adminClipAttachments.js";
import {
  retryProviderAfterTerminalFailure,
  terminalSceneRecovery,
} from "../lib/terminalSceneRecovery.js";
import {
  hasDuplicateImageFailure,
  prepareDuplicateImageRetry,
} from "../lib/duplicateImageRetry.js";

// Billing/salvage state AI jobs stash in the manifest jsonb.
type AiJobMeta = {
  strictUniqueSourcesVersion?: number;
  generationProvider?: string;
  generationMode?: "montage" | "narrative";
  narrativeVisualSource?: "video" | "generated_images";
  imageFirstVersion?: number;
  imageFirstRefundedCredits?: number;
  reservedCredits?: number;
  reservedSubscriptionCredits?: number;
  reservedTopupCredits?: number;
  refunded?: boolean;
  bundledLipSyncEnabled?: boolean;
  imageReview?: {
    phase: "awaiting_approval" | "approved";
    revision: number;
    approvedRevision?: number;
    scenes: Record<string, {
      index: number;
      canonicalPath?: string;
      revision: number;
      source: "original_generation" | "regenerated" | "generated_gallery" | "local_upload";
      prompt: string;
      status?: "ready" | "failed" | "pending" | "uncertain";
      errorMessage?: string;
      acceptedRequestId?: string;
    }>;
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
  partialClips?: Record<string, string>;
  attachedClipSources?: Record<string, string>;
  attachedClipContentHashes?: Record<string, string>;
  narrativeImages?: Record<string, string>;
  pendingRequests?: Record<string, string>;
  rejectedRequests?: Record<string, unknown>;
  pendingImageRequests?: Record<string, unknown>;
  imageSubmissionIntents?: Record<string, unknown>;
  uncertainSubmissions?: Record<string, unknown>;
  submissionIntents?: Record<string, unknown>;
  uncertainImageSubmissions?: Record<string, unknown>;
  targetedSceneRecovery?: {
    sceneIndex: number;
    assetType: "clip";
    allowTerminalSkip: true;
    terminalFallbackProvider: "kling";
    requestedAt: string;
  };
  courtesy30SceneVersion?: number;
  storyboard?: {
    generationMode?: "montage" | "narrative";
    numClips?: number;
    clipDurationSec?: number;
    targetOutputDuration?: number;
    shots?: unknown[];
    timeline?: unknown[];
  };
};
function metaOf(manifest: unknown): AiJobMeta {
  return manifest && typeof manifest === "object" ? (manifest as AiJobMeta) : {};
}

function withoutRecordKey<T>(
  record: Record<string, T> | undefined,
  key: string | null,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record ?? {}).filter(([entryKey]) => entryKey !== key),
  );
}

function isAdmin(email: string | null | undefined): boolean {
  return !!(
    process.env.ADMIN_EMAIL &&
    email &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
}

const router = Router();

// Jobs currently in-flight (queued / analyzing / generating / stitching).
// Used by the admin to spot stuck jobs and force-fail them.
router.get("/admin/jobs/active", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await db
    .select({
      id: jobsTable.id,
      userId: jobsTable.userId,
      email: usersTable.email,
      status: jobsTable.status,
      jobType: jobsTable.jobType,
      prompt: jobsTable.prompt,
      style: jobsTable.style,
      progressPercent: jobsTable.progressPercent,
      requestedDuration: jobsTable.requestedDuration,
      resolution: jobsTable.resolution,
      aiProvider: jobsTable.aiProvider,
      manifest: jobsTable.manifest,
      errorMessage: jobsTable.errorMessage,
      retryCount: jobsTable.retryCount,
      claimedAt: jobsTable.claimedAt,
      createdAt: jobsTable.createdAt,
      updatedAt: jobsTable.updatedAt,
    })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.userId, usersTable.id))
    .where(inArray(jobsTable.status, ["queued", "analyzing", "generating", "stitching"]))
    .orderBy(desc(jobsTable.updatedAt));

  const jobs = rows.map(({ manifest, ...job }) => {
    const meta = metaOf(manifest);
    const storyboard = meta.storyboard;
    return {
      ...job,
      generationMode: meta.generationMode ?? storyboard?.generationMode ?? null,
      plannedScenes: storyboard?.numClips ?? null,
      clipDurationSec: storyboard?.clipDurationSec ?? null,
      reservedCredits: meta.reservedCredits ?? null,
      savedImages: Object.keys(meta.narrativeImages ?? {}).length,
      savedClips: Object.keys(meta.partialClips ?? {}).length,
      pendingImageRequests: Object.keys(meta.pendingImageRequests ?? {}).length,
      pendingClipRequests: Object.keys(meta.pendingRequests ?? {}).length,
    };
  });
  res.json({ jobs });
});

router.get("/admin/jobs/pending", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const jobs = await db
    .select({
      id: jobsTable.id,
      userId: jobsTable.userId,
      email: usersTable.email,
      status: jobsTable.status,
      prompt: jobsTable.prompt,
      style: jobsTable.style,
      requestedDuration: jobsTable.requestedDuration,
      audioSourceType: jobsTable.audioSourceType,
      createdAt: jobsTable.createdAt,
    })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.userId, usersTable.id))
    .where(eq(jobsTable.status, "pending_approval"))
    .orderBy(desc(jobsTable.createdAt))
    .limit(50);

  res.json({ jobs });
});

router.post("/admin/jobs/:id/approve", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { id } = req.params;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "pending_approval") {
    res.status(400).json({ error: "Job is not pending approval" });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({ status: "queued", updatedAt: new Date() })
    .where(eq(jobsTable.id, id))
    .returning();

  req.log.info({ jobId: id }, "Admin approved job — moving to queued");
  res.json(updated);
});

router.get("/admin/jobs/failed", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await db
    .select({
      id: jobsTable.id,
      userId: jobsTable.userId,
      email: usersTable.email,
      status: jobsTable.status,
      prompt: jobsTable.prompt,
      style: jobsTable.style,
      requestedDuration: jobsTable.requestedDuration,
      audioSourceType: jobsTable.audioSourceType,
      errorMessage: jobsTable.errorMessage,
      retryCount: jobsTable.retryCount,
      manifest: jobsTable.manifest,
      createdAt: jobsTable.createdAt,
      updatedAt: jobsTable.updatedAt,
    })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.userId, usersTable.id))
    .where(eq(jobsTable.status, "failed"))
    .orderBy(desc(jobsTable.updatedAt))
    .limit(50);

  const jobs = rows.map(({ manifest, ...job }) => {
    const meta = metaOf(manifest);
    const recovery = terminalSceneRecovery(meta, job.errorMessage);
    const sceneIndex = recovery.sceneKey === null ? null : Number(recovery.sceneKey);
    const validSceneIndex = sceneIndex !== null && Number.isInteger(sceneIndex) && sceneIndex >= 0
      ? sceneIndex
      : null;
    const blockedByUncertainSubmission = recovery.sceneKey !== null && (
      Boolean(meta.submissionIntents?.[recovery.sceneKey]) ||
      Boolean(meta.uncertainSubmissions?.[recovery.sceneKey])
    );
    return {
      ...job,
      plannedScenes: meta.storyboard?.numClips ?? null,
      savedClips: Object.keys(meta.partialClips ?? {}).length,
      terminalSceneIndex: validSceneIndex,
      freshSceneRequestAvailable:
        validSceneIndex !== null &&
        !recovery.unsafe &&
        !blockedByUncertainSubmission,
    };
  });

  res.json({ jobs });
});

router.post("/admin/jobs/:id/retry", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { id } = req.params;
  const outcome = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, id))
      .limit(1)
      .for("update");

    if (!job) return { kind: "missing" as const };
    if (job.status !== "failed") return { kind: "not_failed" as const, status: job.status };

    const meta = metaOf(job.manifest);
    if (hasDuplicateImageFailure(job.errorMessage)) {
      const prepared = prepareDuplicateImageRetry(meta, job.errorMessage);
      if (!prepared) {
        return { kind: "unsafe_recovery_state" as const };
      }
      const [updated] = await tx
        .update(jobsTable)
        .set({
          status: "queued",
          errorMessage: null,
          retryCount: 0,
          claimedAt: null,
          manifest: sql`jsonb_set(
            jsonb_set(
              COALESCE(${jobsTable.manifest}, '{}'::jsonb),
              '{imageReview}',
              ${JSON.stringify(prepared.nextReview)}::jsonb
            ),
            '{resumeReservationRequired}',
            to_jsonb(${prepared.resumeCredits}::int)
          )`,
          updatedAt: new Date(),
        })
        .where(and(eq(jobsTable.id, id), eq(jobsTable.status, "failed")))
        .returning();
      if (!updated) return { kind: "not_failed" as const, status: job.status };
      return {
        kind: "ok" as const,
        job: updated,
        freshSceneIndex: null,
        automaticReplacementSceneIndex: prepared.replacementIndex,
        savedClips: Object.keys(meta.partialClips ?? {}).length,
        plannedScenes: meta.storyboard?.numClips ?? null,
        retryProvider: job.aiProvider,
      };
    }
    const recovery = terminalSceneRecovery(meta, job.errorMessage);
    if (recovery.unsafe) {
      return { kind: "unsafe_recovery_state" as const };
    }
    const freshSceneKey = recovery.sceneKey;
    const retryProvider = retryProviderAfterTerminalFailure(
      meta,
      job.aiProvider,
      freshSceneKey,
    );
    if (
      freshSceneKey !== null &&
      (
        meta.partialClips?.[freshSceneKey] ||
        meta.submissionIntents?.[freshSceneKey] ||
        meta.uncertainSubmissions?.[freshSceneKey]
      )
    ) {
      return { kind: "unsafe_recovery_state" as const };
    }
    let retrySubscriptionReservation = meta.reservedSubscriptionCredits;
    let retryTopupReservation = meta.reservedTopupCredits;
    // A failed render returns its reservation. An explicit admin retry is a
    // new billable provider attempt, so reserve from the user's CURRENT
    // buckets before queueing it. A renewal or another purchase can change the
    // bucket mix after the refund; requiring the historical split would reject
    // a user who still has enough total credits.
    if (meta.refunded && (meta.reservedCredits ?? 0) > 0) {
      const [credits] = await tx
        .select()
        .from(creditsTable)
        .where(eq(creditsTable.userId, job.userId))
        .limit(1)
        .for("update");
      const total = meta.reservedCredits ?? 0;
      const subscriptionDebit = Math.min(credits?.subscriptionCredits ?? 0, total);
      const topupDebit = total - subscriptionDebit;
      if (
        !credits ||
        credits.creditsRemaining < total ||
        credits.topupCredits < topupDebit
      ) {
        return { kind: "insufficient_credits" as const };
      }
      retrySubscriptionReservation = subscriptionDebit;
      retryTopupReservation = topupDebit;
      await tx
        .update(creditsTable)
        .set({
          subscriptionCredits: sql`subscription_credits - ${subscriptionDebit}`,
          topupCredits: sql`topup_credits - ${topupDebit}`,
          creditsRemaining: sql`credits_remaining - ${total}`,
          creditsUsed: sql`credits_used + ${total}`,
          updatedAt: new Date(),
        })
        .where(eq(creditsTable.userId, job.userId));
    }

    // Uncertain image submissions must remain intact. Without a confirmed
    // request id there is no safe way to prove that a replacement image POST
    // would not duplicate a paid request.
    const retryMeta: AiJobMeta = {
      ...meta,
      generationProvider: retryProvider ?? meta.generationProvider,
      rejectedRequests: withoutRecordKey(meta.rejectedRequests, freshSceneKey),
      pendingRequests: withoutRecordKey(meta.pendingRequests, freshSceneKey),
      ...(freshSceneKey === null
        ? {}
        : {
            targetedSceneRecovery: {
              sceneIndex: Number(freshSceneKey),
              assetType: "clip" as const,
              allowTerminalSkip: true as const,
              terminalFallbackProvider: "kling" as const,
              requestedAt: new Date().toISOString(),
            },
          }),
    };
    const [updated] = await tx
      .update(jobsTable)
      .set({
        status: "queued",
        errorMessage: null,
        retryCount: 0,
        claimedAt: null,
        aiProvider: retryProvider,
        manifest: {
          ...retryMeta,
          refunded: false,
          reservedSubscriptionCredits: retrySubscriptionReservation,
          reservedTopupCredits: retryTopupReservation,
        },
        updatedAt: new Date(),
      })
      .where(eq(jobsTable.id, id))
      .returning();
    return {
      kind: "ok" as const,
      job: updated,
      freshSceneIndex: freshSceneKey === null ? null : Number(freshSceneKey),
      savedClips: Object.keys(meta.partialClips ?? {}).length,
      plannedScenes: meta.storyboard?.numClips ?? null,
      retryProvider,
      automaticReplacementSceneIndex: null,
    };
  });

  if (outcome.kind === "missing") {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (outcome.kind === "not_failed") {
    res.status(400).json({ error: `Only failed jobs can be retried (currently ${outcome.status})` });
    return;
  }
  if (outcome.kind === "insufficient_credits") {
    res.status(402).json({ error: "The original user no longer has enough credits to retry this render." });
    return;
  }
  if (outcome.kind === "unsafe_recovery_state") {
    res.status(409).json({
      error: "This job has multiple saved scene requests and cannot be retried safely.",
    });
    return;
  }

  req.log.info(
    {
      jobId: id,
      userId: outcome.job.userId,
      freshSceneIndex: outcome.freshSceneIndex,
      savedClips: outcome.savedClips,
      retryProvider: outcome.retryProvider,
    },
    outcome.freshSceneIndex === null
      ? outcome.automaticReplacementSceneIndex === null
        ? "Admin explicitly retried failed job"
        : "Admin queued an automatic replacement for a duplicate scene image"
      : "Admin queued a fresh request for a terminally rejected scene",
  );
  res.json({
    ...outcome.job,
    recovery: {
      freshSceneIndex: outcome.freshSceneIndex,
      savedClips: outcome.savedClips,
      plannedScenes: outcome.plannedScenes,
      retryProvider: outcome.retryProvider,
      automaticReplacementScene:
        outcome.automaticReplacementSceneIndex === null
          ? null
          : outcome.automaticReplacementSceneIndex + 1,
    },
  });
});

// One-time courtesy conversion for a five-minute 15-scene image-first render.
// It preserves all existing images, clips, and known provider requests; appends
// 15 distinct scenes; refunds the current reservation; and requeues with a
// zero-credit reservation so the platform absorbs the replacement cost.
router.post("/admin/jobs/:id/courtesy-30-scene", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { id } = req.params;
  const outcome = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, id))
      .limit(1)
      .for("update");
    if (!job) return { kind: "missing" as const };
    if (job.jobType !== "ai") return { kind: "invalid" as const, error: "Only AI video jobs are supported." };

    const meta = metaOf(job.manifest);
    if (meta.courtesy30SceneVersion === 1) {
      return { kind: "already" as const, job };
    }
    if (meta.imageFirstVersion !== 1 || meta.narrativeVisualSource !== "generated_images") {
      return { kind: "invalid" as const, error: "This job is not an image-first video." };
    }
    if (
      Object.keys(meta.uncertainImageSubmissions ?? {}).length > 0 ||
      Object.keys(meta.imageSubmissionIntents ?? {}).length > 0 ||
      Object.keys(meta.uncertainSubmissions ?? {}).length > 0 ||
      Object.keys(meta.submissionIntents ?? {}).length > 0
    ) {
      return {
        kind: "invalid" as const,
        error: "The job has an unresolved provider submission and cannot be safely converted.",
      };
    }

    const originalShots = Array.isArray(meta.storyboard?.shots)
      ? meta.storyboard.shots.filter(
          (value): value is {
            index: number;
            label: string;
            startTime: number;
            energy: number;
            usesCharacterReference?: boolean;
            prompt: string;
          } => {
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
          },
        )
      : [];
    if (originalShots.length !== 15) {
      return {
        kind: "invalid" as const,
        error: `Expected exactly 15 existing scenes; found ${originalShots.length}.`,
      };
    }
    const exactFiveMinutePlan =
      job.requestedDuration === "300" &&
      meta.storyboard?.numClips === 15 &&
      meta.storyboard?.clipDurationSec === 10 &&
      meta.storyboard?.targetOutputDuration === 300;
    if (!exactFiveMinutePlan) {
      return {
        kind: "invalid" as const,
        error: "This courtesy action only supports the original five-minute, 15-scene, 10-second plan.",
      };
    }
    const [assetCount] = await tx
      .select({ count: sql<number>`count(DISTINCT ${imageAssetsTable.assetIndex})` })
      .from(imageAssetsTable)
      .where(eq(imageAssetsTable.jobId, id));
    if (Number(assetCount?.count ?? 0) !== 15) {
      return {
        kind: "invalid" as const,
        error: `Expected 15 unique saved source images; found ${Number(assetCount?.count ?? 0)}.`,
      };
    }

    const appendedShots = originalShots.map((shot, offset) => ({
      ...shot,
      index: 15 + offset,
      startTime: 150 + offset * 10,
      label: `${shot.label} — new angle`,
      prompt: `${shot.prompt} Create a completely distinct follow-up shot for the next story beat: use a new camera position, different composition, fresh subject action, and different environmental detail. Do not repeat the previous framing, pose, or scene arrangement.`,
    }));
    const total = meta.refunded ? 0 : (meta.reservedCredits ?? 0);
    const subscriptionRefund = meta.refunded ? 0 : (meta.reservedSubscriptionCredits ?? 0);
    const topupRefund = meta.refunded ? 0 : (meta.reservedTopupCredits ?? 0);
    if (subscriptionRefund + topupRefund !== total) {
      return {
        kind: "invalid" as const,
        error: "The current reservation split does not match the reserved total.",
      };
    }
    if (total > 0) {
      await tx
        .update(creditsTable)
        .set({
          subscriptionCredits: sql`subscription_credits + ${subscriptionRefund}`,
          topupCredits: sql`topup_credits + ${topupRefund}`,
          creditsRemaining: sql`credits_remaining + ${total}`,
          creditsUsed: sql`credits_used - ${total}`,
          updatedAt: new Date(),
        })
        .where(eq(creditsTable.userId, job.userId));
    }

    const nextMeta: AiJobMeta = {
      ...meta,
      generationMode: "narrative",
      courtesy30SceneVersion: 1,
      reservedCredits: 0,
      reservedSubscriptionCredits: 0,
      reservedTopupCredits: 0,
      refunded: false,
      storyboard: {
        ...meta.storyboard,
        generationMode: "narrative",
        numClips: 30,
        clipDurationSec: 10,
        targetOutputDuration: 300,
        shots: [...originalShots, ...appendedShots],
        timeline: Array.from({ length: 30 }, (_, index) => index),
      },
    };
    delete (nextMeta as AiJobMeta & { retryAfter?: number }).retryAfter;

    const [updated] = await tx
      .update(jobsTable)
      .set({
        status: "queued",
        progressPercent: 0,
        errorMessage: null,
        retryCount: 0,
        claimedAt: null,
        manifest: nextMeta as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(jobsTable.id, id))
      .returning();
    return { kind: "ok" as const, job: updated, refundedCredits: total };
  });

  if (outcome.kind === "missing") {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (outcome.kind === "invalid") {
    res.status(409).json({ error: outcome.error });
    return;
  }
  if (outcome.kind === "already") {
    res.json({ ok: true, alreadyConverted: true, job: outcome.job });
    return;
  }
  req.log.info(
    { jobId: id, userId: outcome.job.userId, refundedCredits: outcome.refundedCredits },
    "Admin created zero-credit 30-scene courtesy replacement",
  );
  res.json({
    ok: true,
    alreadyConverted: false,
    refundedCredits: outcome.refundedCredits,
    sceneCount: 30,
    job: outcome.job,
  });
});

router.post("/admin/jobs/:id/notify-on-complete", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { id } = req.params;
  const [job] = await db
    .update(jobsTable)
    .set({
      manifest: sql`jsonb_set(
        COALESCE(${jobsTable.manifest}, '{}'::jsonb),
        '{notifyAdminOnComplete}',
        'true'::jsonb
      )`,
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, id))
    .returning();
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status === "ready") {
    await notifyRequestedAdminRenderReady(job);
  }
  req.log.info({ jobId: id, status: job.status }, "Admin requested job completion email");
  res.json({ ok: true, status: job.status, sentNow: job.status === "ready" });
});

// Force-fail any in-progress job (stitching / generating / etc.) without
// waiting for the auto-recovery timeout. Admin only.
router.post("/admin/jobs/:id/force-fail", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { id } = req.params;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status === "ready" || job.status === "failed") {
    res.status(400).json({ error: `Job is already ${job.status}` });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({
      status: "failed",
      errorMessage: "Manually force-failed by admin",
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, id))
    .returning();

  req.log.info({ jobId: id, previousStatus: job.status }, "Admin force-failed job");
  res.json(updated);
});

router.post("/admin/jobs/:id/reject", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { id } = req.params;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "pending_approval") {
    res.status(400).json({ error: "Job is not pending approval" });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({
      status: "failed",
      errorMessage: "Rejected by admin",
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, id))
    .returning();

  req.log.info({ jobId: id }, "Admin rejected job");
  res.json(updated);
});

// Email delivery smoke test. Sends a test email to the admin, plus optionally
// to any address passed as { to } — use this to verify the Resend API key and
// domain before relying on reset/render emails.
// POST /api/admin/test-email  { to?: string }
router.post("/admin/test-email", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    res.status(500).json({ ok: false, error: "RESEND_API_KEY is not set" });
    return;
  }

  const targets = [process.env.ADMIN_EMAIL!];
  const extra = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  if (extra && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(extra)) targets.push(extra);

  const results: { to: string; ok: boolean; error?: string }[] = [];
  for (const to of targets) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "AIBeatSync <notifications@aibeatsync.com>",
          to,
          subject: "AIBeatSync — email delivery test",
          html: `<div style="font-family:sans-serif;padding:24px"><h2>Email works ✔</h2><p>This is a delivery test sent from the admin panel at ${new Date().toISOString()}.</p></div>`,
        }),
      });
      const body = await r.text();
      results.push(r.ok ? { to, ok: true } : { to, ok: false, error: `Resend ${r.status}: ${body.slice(0, 200)}` });
    } catch (err) {
      results.push({ to, ok: false, error: String(err) });
    }
  }

  req.log.info({ results }, "Admin email test");
  res.json({ ok: results.every((r) => r.ok), results });
});

// Manually attach provider-rendered clips to a job by URL. Used to rescue
// clips that finished on the provider (visible in its dashboard) but were
// never downloaded because polling stopped — the job's next run reuses them
// via manifest.partialClips instead of paying to regenerate.
// Body: { clips: [{ index: number, url: string }] }
router.post("/admin/jobs/:id/attach-clips", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const jobId = req.params.id;
  const clipsInput = Array.isArray(req.body?.clips) ? req.body.clips : null;
  if (!clipsInput || clipsInput.length === 0) {
    res.status(400).json({ error: "Body must be { clips: [{ index, url }] }" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const storage = new ObjectStorageService();
  const results: { index: number; ok: boolean; error?: string }[] = [];
  const acceptedUrls = new Set<string>();
  const acceptedHashes = new Set<string>();
  let attachedCount = 0;
  const initialMeta = metaOf(job.manifest);

  for (const c of clipsInput) {
    const validation = validateClipAttachment(initialMeta, c, acceptedUrls);
    if (!validation.ok) {
      results.push({ index: validation.index, ok: false, error: validation.error });
      continue;
    }
    const { index, url } = validation.clip;
    acceptedUrls.add(url);
    try {
      const buf = await securelyDownloadTrustedClip(url, validation.trustedOrigins);
      if (buf.length < 10_000) throw new Error(`Downloaded file is suspiciously small (${buf.length} bytes) — is the link a video?`);
      const hash = clipContentHash(buf);
      if (
        acceptedHashes.has(hash) ||
        Object.values(initialMeta.attachedClipContentHashes ?? {}).includes(hash)
      ) {
        throw new Error("the same clip content cannot be attached to multiple storyboard indexes");
      }
      acceptedHashes.add(hash);
      // Use a content-addressed admin namespace. The normal processor path is
      // deterministic per scene, so uploading there before the conditional DB
      // update could overwrite a concurrently-finished processor clip.
      const path = await storage.uploadClipBuffer(
        buf,
        `job-${jobId}-admin-${hash.slice(0, 16)}`,
        index,
      );
      const sourceEntry = JSON.stringify({ [index]: url });
      const hashEntry = JSON.stringify({ [index]: hash });
      const pathEntry = JSON.stringify({ [index]: path });
      const strict = initialMeta.strictUniqueSourcesVersion === 1;
      const updated = await db.execute<{ id: string }>(sql`
        UPDATE jobs
        SET manifest = jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(manifest, '{}'::jsonb),
                  '{partialClips}',
                  COALESCE(manifest->'partialClips', '{}'::jsonb) || ${pathEntry}::jsonb
                ),
                '{attachedClipSources}',
                COALESCE(manifest->'attachedClipSources', '{}'::jsonb) || ${sourceEntry}::jsonb
              ),
              '{attachedClipContentHashes}',
              COALESCE(manifest->'attachedClipContentHashes', '{}'::jsonb) || ${hashEntry}::jsonb
            ),
            updated_at = NOW()
        WHERE id = ${jobId}
          AND (
            ${!strict}
            OR (
              NOT (COALESCE(manifest->'partialClips', '{}'::jsonb) ? ${String(index)})
              AND (${index} >= 0)
              AND (${index} < COALESCE((manifest->'storyboard'->>'numClips')::int, 0))
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_each_text(COALESCE(manifest->'attachedClipSources', '{}'::jsonb))
                WHERE value = ${url}
              )
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_each_text(COALESCE(manifest->'attachedClipContentHashes', '{}'::jsonb))
                WHERE value = ${hash}
              )
            )
          )
        RETURNING id
      `);
      if (updated.rows.length === 0) {
        throw new Error("clip attachment conflicted with the immutable storyboard mapping");
      }
      attachedCount++;
      results.push({ index, ok: true });
    } catch (err) {
      results.push({ index, ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 300) });
    }
  }

  req.log.info({ jobId, results }, "Admin attached clips to job");
  res.json({ ok: results.every((r) => r.ok), attached: attachedCount, results });
});

// Stop a stuck/failing job and finish the video from the clips already saved
// (manifest.partialClips / reclaimable pendingRequests) with ZERO new provider
// spend. Sets manifest.finalizeWithPartial and re-queues; generateClips honors
// the flag by skipping any clip that can't be reused for free.
router.post("/admin/jobs/:id/finalize-partial", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const jobId = req.params.id;
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status === "ready") {
    res.status(400).json({ error: "Job already finished" });
    return;
  }

  const manifest = (job.manifest ?? {}) as { partialClips?: Record<string, string>; pendingRequests?: Record<string, string> };
  const saved = Object.keys(manifest.partialClips ?? {}).length;
  const pending = Object.keys(manifest.pendingRequests ?? {}).length;
  if (saved === 0 && pending === 0) {
    res.status(400).json({ error: "No saved clips to finalize with — attach clips first" });
    return;
  }

  // Atomic: set the flag without clobbering concurrently-written manifest keys,
  // and re-queue with retryCount 0 (matches the retry endpoint) so claiming it
  // is NOT treated as a paid retry.
  await db.execute(sql`
    UPDATE jobs
    SET manifest = jsonb_set(COALESCE(manifest, '{}'::jsonb), '{finalizeWithPartial}', 'true'::jsonb),
        status = 'queued',
        error_message = NULL,
        retry_count = 0,
        claimed_at = NULL,
        updated_at = NOW()
    WHERE id = ${jobId}
  `);

  req.log.info({ jobId, saved, pending }, "Admin requested finalize-with-partial — job re-queued");
  res.json({ ok: true, savedClips: saved, pendingRequests: pending });
});

// ---- Bulk recovery of stranded renders -------------------------------------
// Videos that failed because clips finished on Pixazo AFTER the server stopped
// polling (crash/freeze/deploy) leave recoverable state in the job manifest:
//   partialClips     — clips already rendered + stored (reused for free)
//   pendingRequests  — clips submitted to Pixazo, reclaimable for free by URL
// Re-queuing such a job makes the worker reclaim/reuse those and regenerate only
// what's genuinely missing, then stitch + deliver — no double provider spend.

// GET /admin/jobs/recoverable — dry run: list failed AI jobs and what each can
// recover, with a summary. No side effects.
router.get("/admin/jobs/recoverable", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await db
    .select({
      id: jobsTable.id,
      email: usersTable.email,
      prompt: jobsTable.prompt,
      requestedDuration: jobsTable.requestedDuration,
      resolution: jobsTable.resolution,
      errorMessage: jobsTable.errorMessage,
      retryCount: jobsTable.retryCount,
      createdAt: jobsTable.createdAt,
      updatedAt: jobsTable.updatedAt,
      manifest: jobsTable.manifest,
    })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.userId, usersTable.id))
    .where(and(eq(jobsTable.status, "failed"), eq(jobsTable.jobType, "ai")))
    .orderBy(desc(jobsTable.updatedAt))
    .limit(300);

  const jobs = rows.map((r) => {
    const m = metaOf(r.manifest);
    const partialClips = Object.keys(m.partialClips ?? {}).length;
    const pendingRequests = Object.keys(m.pendingRequests ?? {}).length;
    return {
      id: r.id,
      email: r.email,
      prompt: r.prompt ? r.prompt.slice(0, 80) : null,
      requestedDuration: r.requestedDuration,
      resolution: r.resolution,
      errorMessage: r.errorMessage ? r.errorMessage.slice(0, 160) : null,
      retryCount: r.retryCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      reservedCredits: m.reservedCredits ?? 0,
      refunded: !!m.refunded,
      partialClips,
      pendingRequests,
      // "salvageable" = has clips to reuse or requests to reclaim for free.
      salvageable: partialClips > 0 || pendingRequests > 0,
    };
  });

  const summary = {
    totalFailed: jobs.length,
    salvageable: jobs.filter((j) => j.salvageable).length,
    reclaimableRequests: jobs.reduce((a, j) => a + j.pendingRequests, 0),
    alreadyRenderedClips: jobs.reduce((a, j) => a + j.partialClips, 0),
    refundedThatWouldRecharge: jobs.filter((j) => j.salvageable && j.refunded && j.reservedCredits > 0).length,
  };

  res.json({ jobs, summary });
});

// POST /admin/jobs/recover — re-queue failed AI jobs so the worker reclaims
// finished renders and delivers the video. Body (all optional):
//   ids            — restrict to these job ids (default: all failed AI jobs)
//   onlyWithSalvage — default true; only re-queue jobs that have partialClips
//                     or pendingRequests (avoids full-price regeneration).
// Jobs whose reservation was already refunded are re-reserved (re-charged) so a
// successful recovery bills consistently with a normal render.
router.post("/admin/jobs/recover", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter((x: unknown): x is string => typeof x === "string")
    : null;
  const onlyWithSalvage = req.body?.onlyWithSalvage !== false;

  const rows = await db
    .select({ id: jobsTable.id, userId: jobsTable.userId, manifest: jobsTable.manifest })
    .from(jobsTable)
    .where(
      ids && ids.length
        ? and(eq(jobsTable.status, "failed"), eq(jobsTable.jobType, "ai"), inArray(jobsTable.id, ids))
        : and(eq(jobsTable.status, "failed"), eq(jobsTable.jobType, "ai")),
    )
    .limit(500);

  const candidates = rows.filter((r) => {
    if (!onlyWithSalvage) return true;
    const m = metaOf(r.manifest);
    return Object.keys(m.partialClips ?? {}).length > 0 || Object.keys(m.pendingRequests ?? {}).length > 0;
  });

  let recharged = 0;
  for (const r of candidates) {
    const m = metaOf(r.manifest);
    // If we refunded this job on failure, re-reserve the credits now — the user
    // is about to receive the finished video, so charge as a normal render.
    if (m.refunded && (m.reservedCredits ?? 0) > 0) {
      const reserved = m.reservedCredits!;
      await db
        .update(creditsTable)
        .set({
          subscriptionCredits: sql`GREATEST(subscription_credits - ${reserved}, 0)`,
          topupCredits: sql`GREATEST(topup_credits - GREATEST(${reserved} - subscription_credits, 0), 0)`,
          creditsRemaining: sql`GREATEST(credits_remaining - ${reserved}, 0)`,
          creditsUsed: sql`credits_used + ${reserved}`,
          updatedAt: new Date(),
        })
        .where(eq(creditsTable.userId, r.userId));
      await db.execute(sql`
        UPDATE jobs SET manifest = jsonb_set(COALESCE(manifest, '{}'::jsonb), '{refunded}', 'false'::jsonb)
        WHERE id = ${r.id}
      `);
      recharged++;
    }
  }

  const requeuedIds = candidates.map((r) => r.id);
  if (requeuedIds.length) {
    await db
      .update(jobsTable)
      .set({ status: "queued", errorMessage: null, retryCount: 0, claimedAt: null, updatedAt: new Date() })
      .where(inArray(jobsTable.id, requeuedIds));
  }

  req.log.info(
    { requeued: requeuedIds.length, recharged, onlyWithSalvage, scoped: !!(ids && ids.length), scanned: rows.length },
    "Admin bulk-recovered failed jobs",
  );
  res.json({ ok: true, requeued: requeuedIds.length, recharged, scanned: rows.length, requeuedIds });
});

export default router;
