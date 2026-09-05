import { Router } from "express";
import { randomUUID } from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { creditsTable, db, imageAssetsTable, jobsTable } from "@workspace/db";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "../lib/creditCost.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { toCustomerJobView } from "../lib/customerJobView.js";
import {
  imageReviewReplacementCredits,
  isOwnedUploadObjectPath,
} from "../lib/imageReviewBilling.js";
import {
  assertStrictUniqueMedia,
  perceptualFingerprint,
} from "../lib/mediaUniqueness.js";

const router = Router();
const storage = new ObjectStorageService();

type ReviewScene = {
  index: number;
  canonicalPath?: string;
  revision: number;
  source: "original_generation" | "regenerated" | "generated_gallery" | "local_upload";
  prompt: string;
  status?: "ready" | "failed" | "pending" | "uncertain";
  errorMessage?: string;
  acceptedRequestId?: string;
};

type ReviewReplacement = {
  id: string;
  index: number;
  prompt: string;
  credits: number;
  subscriptionCredits: number;
  topupCredits: number;
  status: "queued" | "processing" | "uncertain";
  createdAt: string;
};

type ImageReview = {
  phase: "awaiting_approval" | "approved";
  revision: number;
  approvedRevision?: number;
  scenes: Record<string, ReviewScene>;
  pendingReplacements?: Record<string, ReviewReplacement>;
};

type JobManifest = {
  imageFirstVersion?: number;
  strictUniqueSourcesVersion?: number;
  refunded?: boolean;
  imageFirstRefundedCredits?: number;
  resumeReservationRequired?: number;
  reservedCredits?: number;
  reservedSubscriptionCredits?: number;
  reservedTopupCredits?: number;
  imageCreditCost?: number;
  videoCreditCost?: number;
  bundledLipSyncEnabled?: boolean;
  imageReview?: ImageReview;
  storyboard?: { shots?: unknown[] };
  pendingImageRequests?: Record<string, unknown>;
  imageSubmissionIntents?: Record<string, unknown>;
  uncertainImageSubmissions?: Record<string, unknown>;
};

function reviewOf(manifest: unknown): ImageReview | null {
  if (!manifest || typeof manifest !== "object") return null;
  const review = (manifest as JobManifest).imageReview;
  return review && typeof review.revision === "number" && review.scenes
    ? review
    : null;
}

function validImage(buffer: Buffer): boolean {
  return (
    (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    || (buffer.length >= 8
      && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e
      && buffer[3] === 0x4e && buffer[4] === 0x0d && buffer[5] === 0x0a
      && buffer[6] === 0x1a && buffer[7] === 0x0a)
    || (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF"
      && buffer.toString("ascii", 8, 12) === "WEBP")
  );
}

function imageDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50
    && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP"
    && buffer.toString("ascii", 12, 16) === "VP8X") {
    return {
      width: 1 + buffer[24]! + (buffer[25]! << 8) + (buffer[26]! << 16),
      height: 1 + buffer[27]! + (buffer[28]! << 8) + (buffer[29]! << 16),
    };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1]!;
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return null;
}

async function notify(jobId: string): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_notify(${`job_${jobId.replace(/-/g, "_")}`}, 'update')`);
  } catch {
    // The job page also polls, so a notification outage is non-fatal.
  }
}

const replacementsBody = z.object({
  scenes: z.array(z.object({
    index: z.coerce.number().int().min(0),
    prompt: z.string().trim().min(1).max(1000),
  })).min(1).max(64),
});

const sourceBody = z.object({
  index: z.coerce.number().int().min(0),
  source: z.enum(["gallery", "upload"]),
  imageAssetId: z.string().optional(),
  objectPath: z.string().regex(/^\/objects\/.+/).optional(),
});

router.post("/jobs/:id/image-review/replacements", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = replacementsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Select scenes and provide a prompt up to 1000 characters." });
    return;
  }
  const indexes = parsed.data.scenes.map((scene) => scene.index);
  if (new Set(indexes).size !== indexes.length) {
    res.status(400).json({ error: "Each scene can only have one replacement in progress." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobsTable)
      .where(and(eq(jobsTable.id, req.params.id), eq(jobsTable.userId, req.user.id)))
      .limit(1).for("update");
    const review = reviewOf(job?.manifest);
    if (!job || !review || review.phase !== "awaiting_approval") {
      return { error: "This job is not waiting for image review.", status: 409 as const };
    }
    for (const scene of parsed.data.scenes) {
      if (!review.scenes[String(scene.index)]) {
        return { error: `Scene ${scene.index + 1} is not part of this storyboard.`, status: 422 as const };
      }
      if (Object.values(review.pendingReplacements ?? {}).some((pending) => pending.index === scene.index)) {
        return { error: `Scene ${scene.index + 1} already has a replacement in progress.`, status: 409 as const };
      }
      if (
        job.manifest
        && typeof job.manifest === "object"
        && (
          (job.manifest as JobManifest).pendingImageRequests?.[String(scene.index)]
          || (job.manifest as JobManifest).imageSubmissionIntents?.[String(scene.index)]
          || (job.manifest as JobManifest).uncertainImageSubmissions?.[String(scene.index)]
        )
      ) {
        return {
          error: `Scene ${scene.index + 1} has an earlier image request that is still being recovered. Choose another image or upload one instead.`,
          status: 409 as const,
        };
      }
    }
    const [credits] = await tx.select().from(creditsTable)
      .where(eq(creditsTable.userId, req.user.id)).limit(1).for("update");
    const replacementCosts = parsed.data.scenes.map((scene) =>
      imageReviewReplacementCredits(review!.scenes[String(scene.index)]!),
    );
    const total = replacementCosts.reduce((sum, credits) => sum + credits, 0);
    if (!credits || credits.creditsRemaining < total) {
      return {
        error: `Replacement generation needs ${total} credits, but only ${credits?.creditsRemaining ?? 0} are available.`,
        status: 402 as const,
      };
    }
    let subscriptionRemaining = credits.subscriptionCredits;
    const pending: Record<string, ReviewReplacement> = {};
    for (const [sceneIndex, scene] of parsed.data.scenes.entries()) {
      const id = randomUUID();
      const sceneCredits = replacementCosts[sceneIndex]!;
      const subscriptionCredits = Math.min(sceneCredits, subscriptionRemaining);
      subscriptionRemaining -= subscriptionCredits;
      pending[id] = {
        id,
        index: scene.index,
        prompt: scene.prompt,
        credits: sceneCredits,
        subscriptionCredits,
        topupCredits: sceneCredits - subscriptionCredits,
        status: "queued",
        createdAt: new Date().toISOString(),
      };
    }
    const subscriptionDebit = total - (total - Math.min(total, credits.subscriptionCredits));
    const topupDebit = total - subscriptionDebit;
    await tx.update(creditsTable).set({
      subscriptionCredits: sql`${creditsTable.subscriptionCredits} - ${subscriptionDebit}`,
      topupCredits: sql`${creditsTable.topupCredits} - ${topupDebit}`,
      creditsRemaining: sql`${creditsTable.creditsRemaining} - ${total}`,
      creditsUsed: sql`${creditsTable.creditsUsed} + ${total}`,
      updatedAt: new Date(),
    }).where(eq(creditsTable.userId, req.user.id));
    await tx.update(jobsTable).set({
      status: "queued",
      claimedAt: null,
      errorMessage: null,
      manifest: sql`jsonb_set(
        COALESCE(${jobsTable.manifest}, '{}'::jsonb),
        '{imageReview,pendingReplacements}',
        COALESCE(${jobsTable.manifest}->'imageReview'->'pendingReplacements', '{}'::jsonb)
          || ${JSON.stringify(pending)}::jsonb
      )`,
      updatedAt: new Date(),
    }).where(eq(jobsTable.id, req.params.id));
    return { total, count: parsed.data.scenes.length };
  });
  if ("error" in result) {
    res.status(result.status ?? 409).json({ error: result.error });
    return;
  }
  await notify(req.params.id);
  res.status(202).json({ ok: true, credits: result.total, count: result.count });
});

router.post("/jobs/:id/image-review/source", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = sourceBody.safeParse(req.body);
  if (!parsed.success || (parsed.data.source === "gallery" && !parsed.data.imageAssetId)
    || (parsed.data.source === "upload" && !parsed.data.objectPath)) {
    res.status(400).json({ error: "Choose an owned generated image or a stored local image." });
    return;
  }
  let sourcePath = parsed.data.objectPath;
  if (parsed.data.source === "gallery") {
    const [asset] = await db.select({ objectPath: imageAssetsTable.objectPath })
      .from(imageAssetsTable).where(and(
        eq(imageAssetsTable.id, parsed.data.imageAssetId!),
        eq(imageAssetsTable.userId, req.user.id),
        isNull(imageAssetsTable.deletedAt),
      )).limit(1);
    if (!asset) {
      res.status(404).json({ error: "That generated image is no longer available." });
      return;
    }
    sourcePath = asset.objectPath;
  } else if (!isOwnedUploadObjectPath(sourcePath, req.user.id)) {
    res.status(404).json({ error: "Object not found" });
    return;
  }
  try {
    const file = await storage.getObjectEntityFile(sourcePath!);
    const [buffer] = await file.download();
    if (buffer.length > 15 * 1024 * 1024 || !validImage(buffer)) {
      res.status(422).json({ error: "Use a JPEG, PNG, or WebP image up to 15 MB." });
      return;
    }
    const dimensions = imageDimensions(buffer);
    if (!dimensions || dimensions.width < 256 || dimensions.height < 256) {
      res.status(422).json({ error: "Images must be at least 256 × 256 pixels." });
      return;
    }
    const targetRatio = (await db.select({ aspectRatio: jobsTable.aspectRatio })
      .from(jobsTable).where(eq(jobsTable.id, req.params.id)).limit(1))[0]?.aspectRatio;
    const sourceRatio = dimensions.width / dimensions.height;
    const targetIsLandscape = targetRatio === "16:9";
    if ((sourceRatio >= 1) !== targetIsLandscape) {
      res.status(422).json({
        error: `Choose an image compatible with the ${targetIsLandscape ? "16:9 landscape" : "9:16 portrait"} storyboard.`,
      });
      return;
    }
    const ownedPath = await storage.uploadNarrativeImageBuffer(
      buffer,
      `${req.params.id}-review-${randomUUID()}`,
      parsed.data.index,
    );
    const result = await db.transaction(async (tx) => {
      const [job] = await tx.select().from(jobsTable)
        .where(and(eq(jobsTable.id, req.params.id), eq(jobsTable.userId, req.user.id)))
        .limit(1).for("update");
      const review = reviewOf(job?.manifest);
      const scene = review?.scenes[String(parsed.data.index)];
      if (!job || !review || review.phase !== "awaiting_approval" || !scene) return null;
      if (Object.values(review.pendingReplacements ?? {}).some((pending) => pending.index === parsed.data.index)) {
        return "pending";
      }
      const revision = review.revision + 1;
      const { errorMessage: _errorMessage, ...sceneWithoutError } = scene;
      const nextScene: ReviewScene = {
        ...sceneWithoutError,
        canonicalPath: ownedPath,
        revision,
        source: parsed.data.source === "gallery" ? "generated_gallery" : "local_upload",
        status: "ready",
      };
      const nextReview = {
        ...review,
        revision,
        scenes: { ...review.scenes, [String(parsed.data.index)]: nextScene },
      };
      await tx.insert(imageAssetsTable).values({
        id: randomUUID(),
        userId: req.user.id,
        jobId: req.params.id,
        assetIndex: parsed.data.index,
        objectPath: ownedPath,
        prompt: scene.prompt,
        style: job.style,
      }).onConflictDoUpdate({
        target: [imageAssetsTable.jobId, imageAssetsTable.assetIndex],
        set: { objectPath: ownedPath, prompt: scene.prompt },
      });
      await tx.update(jobsTable).set({
        manifest: sql`jsonb_set(COALESCE(${jobsTable.manifest}, '{}'::jsonb), '{imageReview}', ${JSON.stringify(nextReview)}::jsonb)`,
        updatedAt: new Date(),
      }).where(eq(jobsTable.id, req.params.id));
      return nextScene;
    });
    if (result === null) {
      res.status(409).json({ error: "This job is no longer waiting for image review." });
      return;
    }
    if (result === "pending") {
      res.status(409).json({ error: "Wait for the current replacement to finish before changing this scene." });
      return;
    }
    await notify(req.params.id);
    res.json({ ok: true, scene: result });
  } catch (error) {
    req.log.warn({ err: error, jobId: req.params.id }, "Image review source validation failed");
    res.status(422).json({ error: "The selected image could not be stored. Use a JPEG, PNG, or WebP image up to 15 MB." });
  }
});

router.post("/jobs/:id/image-review/approve", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Inspect the exact stored images before changing job state. This deliberately
  // runs outside the approval transaction because downloads and fingerprints
  // can take several seconds; the transaction below fences the review revision.
  const [preflightJob] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, req.params.id), eq(jobsTable.userId, req.user.id)))
    .limit(1);
  const preflightManifest = preflightJob?.manifest as JobManifest | null | undefined;
  const preflightReview = reviewOf(preflightManifest);
  if (!preflightJob || !preflightReview || preflightReview.phase !== "awaiting_approval") {
    res.status(409).json({ error: "This job is not waiting for image approval." });
    return;
  }
  const preflightRevision = preflightReview.revision;
  if (preflightManifest?.strictUniqueSourcesVersion === 1) {
    const expected = Array.isArray(preflightManifest.storyboard?.shots)
      ? preflightManifest.storyboard.shots.length
      : 0;
    const indexes = Object.keys(preflightReview.scenes).map(Number).sort((a, b) => a - b);
    const assets = await db.select({
      assetIndex: imageAssetsTable.assetIndex,
      objectPath: imageAssetsTable.objectPath,
    }).from(imageAssetsTable).where(eq(imageAssetsTable.jobId, req.params.id));
    const byIndex = new Map(assets.map((asset) => [asset.assetIndex, asset.objectPath]));
    if (
      !expected
      || indexes.length !== expected
      || indexes.some((index, position) => index !== position)
      || indexes.some((index) => {
        const scene = preflightReview.scenes[String(index)];
        return !scene?.canonicalPath
          || (scene.status !== undefined && scene.status !== "ready")
          || byIndex.get(index) !== scene.canonicalPath;
      })
    ) {
      res.status(422).json({ error: "Every storyboard scene must have one finished image before approval." });
      return;
    }
    try {
      const fingerprints = [];
      for (const index of indexes) {
        const file = await storage.getObjectEntityFile(byIndex.get(index)!);
        const [buffer] = await file.download();
        fingerprints.push(await perceptualFingerprint(buffer, "image"));
      }
      assertStrictUniqueMedia(true, fingerprints, "scene image");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const positions = /positions (\d+) and (\d+)/i.exec(detail);
      if (positions) {
        res.status(422).json({
          error: `Scenes ${positions[1]} and ${positions[2]} appear to use the same image. Replace one of them before approving the images.`,
          code: "DUPLICATE_SCENE_IMAGES",
          duplicateScenes: [Number(positions[1]), Number(positions[2])],
        });
        return;
      }
      req.log.warn({ err: error, jobId: req.params.id }, "Approved image uniqueness preflight failed");
      res.status(422).json({
        error: "The finished images could not be verified. Try approving them again.",
        code: "IMAGE_APPROVAL_INSPECTION_FAILED",
      });
      return;
    }
  }
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobsTable)
      .where(and(eq(jobsTable.id, req.params.id), eq(jobsTable.userId, req.user.id)))
      .limit(1).for("update");
    const manifest = job?.manifest as JobManifest | null | undefined;
    const review = reviewOf(manifest);
    if (
      !job
      || job.status !== "pending_approval"
      || !review
      || review.phase !== "awaiting_approval"
    ) {
      return { error: "This job is not waiting for image approval.", status: 409 as const };
    }
    if (review.revision !== preflightRevision) {
      return { error: "A scene image changed during approval. Review the latest images and approve again.", status: 409 as const };
    }
    if (Object.keys(review.pendingReplacements ?? {}).length) {
      return { error: "Wait for all replacement images to finish.", status: 409 as const };
    }
    const expected = Array.isArray(manifest?.storyboard?.shots) ? manifest.storyboard.shots.length : 0;
    const indexes = Object.keys(review.scenes).map(Number).sort((a, b) => a - b);
    if (!expected || indexes.length !== expected || indexes.some((index, position) => index !== position)) {
      return { error: "Every storyboard scene must have one image before approval.", status: 422 as const };
    }
    const assets = await tx.select({ assetIndex: imageAssetsTable.assetIndex, objectPath: imageAssetsTable.objectPath })
      .from(imageAssetsTable).where(eq(imageAssetsTable.jobId, req.params.id));
    const byIndex = new Map(assets.map((asset) => [asset.assetIndex, asset.objectPath]));
    if (indexes.some((index) => {
      const scene = review.scenes[String(index)];
      return !scene?.canonicalPath
        || (scene.status !== undefined && scene.status !== "ready")
        || byIndex.get(index) !== scene.canonicalPath;
    })) {
      return { error: "Every approved scene image must be durably stored before approval.", status: 422 as const };
    }
    const resumeCredits = manifest?.refunded === true
      ? Math.max(0, manifest.resumeReservationRequired ?? 0)
      : 0;
    if (resumeCredits > 0 && manifest?.bundledLipSyncEnabled === true) {
      return {
        error: "This bundled generation cannot be resumed from retained images.",
        status: 409 as const,
        code: "BUNDLED_RESUME_UNAVAILABLE" as const,
      };
    }
    let resumeSubscriptionDebit = 0;
    let resumeTopupDebit = 0;
    if (resumeCredits > 0) {
      const [credits] = await tx
        .select()
        .from(creditsTable)
        .where(eq(creditsTable.userId, req.user.id))
        .limit(1)
        .for("update");
      const available = Math.max(0, credits?.creditsRemaining ?? 0);
      if (!credits || available < resumeCredits) {
        return {
          error: `Resuming this video requires ${resumeCredits} credits, but you have ${available}.`,
          status: 402 as const,
          code: "INSUFFICIENT_CREDITS" as const,
          creditsRequired: resumeCredits,
          creditsRemaining: available,
        };
      }
      resumeSubscriptionDebit = Math.min(
        resumeCredits,
        Math.max(0, credits.subscriptionCredits),
      );
      resumeTopupDebit = resumeCredits - resumeSubscriptionDebit;
      if (resumeTopupDebit > Math.max(0, credits.topupCredits)) {
        return {
          error: `Resuming this video requires ${resumeCredits} credits, but you have ${available}.`,
          status: 402 as const,
          code: "INSUFFICIENT_CREDITS" as const,
          creditsRequired: resumeCredits,
          creditsRemaining: available,
        };
      }
      await tx.update(creditsTable).set({
        subscriptionCredits: sql`${creditsTable.subscriptionCredits} - ${resumeSubscriptionDebit}`,
        topupCredits: sql`${creditsTable.topupCredits} - ${resumeTopupDebit}`,
        creditsRemaining: sql`${creditsTable.creditsRemaining} - ${resumeCredits}`,
        creditsUsed: sql`${creditsTable.creditsUsed} + ${resumeCredits}`,
        updatedAt: new Date(),
      }).where(eq(creditsTable.userId, req.user.id));
    }
    const nextReview = { ...review, phase: "approved" as const, approvedRevision: review.revision };
    const nextManifest = resumeCredits > 0
      ? sql`jsonb_set(
          COALESCE(${jobsTable.manifest}, '{}'::jsonb),
          '{imageReview}',
          ${JSON.stringify(nextReview)}::jsonb
        ) || jsonb_build_object(
          'refunded', false,
          'reservedCredits', ${resumeCredits}::integer,
          'reservedSubscriptionCredits', ${resumeSubscriptionDebit}::integer,
          'reservedTopupCredits', ${resumeTopupDebit}::integer,
          'imageCreditCost', 0,
          'videoCreditCost', ${resumeCredits}::integer,
          'imageFirstRefundedCredits', 0,
          'resumeReservationRequired', 0
        )`
      : sql`jsonb_set(
          COALESCE(${jobsTable.manifest}, '{}'::jsonb),
          '{imageReview}',
          ${JSON.stringify(nextReview)}::jsonb
        )`;
    const [updated] = await tx.update(jobsTable).set({
      status: "queued",
      claimedAt: null,
      errorMessage: null,
      manifest: nextManifest,
      updatedAt: new Date(),
    }).where(and(eq(jobsTable.id, req.params.id), eq(jobsTable.status, "pending_approval"))).returning();
    return updated
      ? { job: updated }
      : { error: "This job changed before approval could be saved.", status: 409 as const };
  });
  if ("error" in result) {
    res.status(result.status ?? 409).json({
      error: result.error,
      ...("code" in result ? {
        code: result.code,
        creditsRequired: result.creditsRequired,
        creditsRemaining: result.creditsRemaining,
      } : {}),
    });
    return;
  }
  await notify(req.params.id);
  res.json(toCustomerJobView(result.job));
});

// A queued replacement has been reserved but has not reached an external
// provider. Processing replacements are deliberately left untouched because
// the provider may already have accepted them; settlement is conservative.
export async function refundQueuedImageReviewReplacements(jobId: string, userId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1).for("update");
    const review = reviewOf(job?.manifest);
    const queued = Object.values(review?.pendingReplacements ?? {}).filter((item) => item.status === "queued");
    if (!job || !review || queued.length === 0) return 0;
    const total = queued.reduce((sum, item) => sum + item.credits, 0);
    const subscription = queued.reduce((sum, item) => sum + item.subscriptionCredits, 0);
    const topup = queued.reduce((sum, item) => sum + item.topupCredits, 0);
    await tx.update(creditsTable).set({
      subscriptionCredits: sql`${creditsTable.subscriptionCredits} + ${subscription}`,
      topupCredits: sql`${creditsTable.topupCredits} + ${topup}`,
      creditsRemaining: sql`${creditsTable.creditsRemaining} + ${total}`,
      creditsUsed: sql`GREATEST(${creditsTable.creditsUsed} - ${total}, 0)`,
      updatedAt: new Date(),
    }).where(eq(creditsTable.userId, userId));
    const remaining = Object.fromEntries(Object.entries(review.pendingReplacements ?? {})
      .filter(([, item]) => item.status !== "queued"));
    const nextReview = { ...review, pendingReplacements: remaining };
    await tx.update(jobsTable).set({
      manifest: sql`jsonb_set(COALESCE(${jobsTable.manifest}, '{}'::jsonb), '{imageReview}', ${JSON.stringify(nextReview)}::jsonb)`,
      updatedAt: new Date(),
    }).where(eq(jobsTable.id, jobId));
    return total;
  });
}

export default router;