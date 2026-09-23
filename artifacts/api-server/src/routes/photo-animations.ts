import { createHash, randomUUID } from "crypto";
import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { creditsTable, db, imageAssetsTable, jobsTable, usersTable } from "@workspace/db";
import { calculateCreditCost } from "../lib/creditCost.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { assessGeneratedMediaPrompt } from "../lib/promptSafety.js";
import { perceptualFingerprint } from "../lib/mediaUniqueness.js";

const router = Router();
const storage = new ObjectStorageService();
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), imageAssetId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("upload"), objectPath: z.string().trim().min(1).max(500) }).strict(),
]);
const commonSchema = z.object({
  source: sourceSchema,
  prompt: z.string().trim().min(1).max(1000),
  durationSeconds: z.union([z.literal(5), z.literal(10)]),
  provider: z.enum(["kling", "runway"]),
  // Existing Runway image-to-video requests do not carry a resolution field,
  // and the Kling gateway's source-image mode does not guarantee 1080p. Do not
  // quote a premium output the selected providers cannot currently guarantee.
  resolution: z.literal("720p"),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
}).strict();
const submitSchema = commonSchema.extend({
  approved: z.literal(true),
  expectedCredits: z.number().int().positive(),
  planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().uuid(),
}).strict();

type CommonInput = z.infer<typeof commonSchema>;
type ResolvedSource = {
  requestSource: CommonInput["source"];
  objectPath: string;
  contentHash: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  buffer: Buffer;
  imageAssetId?: string;
};

export function photoAnimationProviderAvailable(provider: CommonInput["provider"]): boolean {
  return provider === "kling"
    ? Boolean(process.env.PIXAZO_API_KEY?.trim())
    : Boolean(process.env.RUNWAY_API_KEY?.trim());
}

function ownedUploadPath(path: string, userId: string): boolean {
  if (!path.startsWith("/objects/uploads/")) return false;
  const parts = path.slice("/objects/uploads/".length).split("/");
  return parts.length >= 2
    && parts[0] === userId
    && parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function imageKind(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function imageDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 30 && buffer.toString("ascii", 12, 16) === "VP8X") {
    return {
      width: 1 + buffer[24]! + (buffer[25]! << 8) + (buffer[26]! << 16),
      height: 1 + buffer[27]! + (buffer[28]! << 8) + (buffer[29]! << 16),
    };
  }
  if (
    buffer.length >= 30
    && buffer.toString("ascii", 12, 16) === "VP8 "
    && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a
  ) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (
    buffer.length >= 25
    && buffer.toString("ascii", 12, 16) === "VP8L"
    && buffer[20] === 0x2f
  ) {
    return {
      width: 1 + buffer[21]! + ((buffer[22]! & 0x3f) << 8),
      height: 1 + (buffer[22]! >> 6) + (buffer[23]! << 2) + ((buffer[24]! & 0x0f) << 10),
    };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1]!;
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return null;
}

async function resolveAndValidateSource(source: CommonInput["source"], userId: string): Promise<ResolvedSource> {
  let objectPath: string;
  let imageAssetId: string | undefined;
  if (source.kind === "asset") {
    const [asset] = await db.select({
      id: imageAssetsTable.id,
      objectPath: imageAssetsTable.objectPath,
    }).from(imageAssetsTable).where(and(
      eq(imageAssetsTable.id, source.imageAssetId),
      eq(imageAssetsTable.userId, userId),
      isNull(imageAssetsTable.deletedAt),
    )).limit(1);
    if (!asset) throw Object.assign(new Error("The selected image is unavailable."), { status: 404, code: "SOURCE_NOT_FOUND" });
    objectPath = asset.objectPath;
    imageAssetId = asset.id;
  } else {
    if (!ownedUploadPath(source.objectPath, userId)) {
      throw Object.assign(new Error("The uploaded image is unavailable."), { status: 404, code: "SOURCE_NOT_FOUND" });
    }
    objectPath = source.objectPath;
  }

  let contentHash = "";
  let contentType: ResolvedSource["contentType"] | null = null;
  let sourceBuffer: Buffer | null = null;
  try {
    const file = await storage.getObjectEntityFile(objectPath);
    if (source.kind === "upload" && !(await storage.canAccessObjectEntity({ userId, objectFile: file }))) {
      throw Object.assign(new Error("forbidden"), { forbidden: true });
    }
    const [metadata, buffer] = await Promise.all([file.getMetadata().then(([value]) => value), storage.downloadObjectBuffer(objectPath)]);
    const kind = imageKind(buffer);
    const declaredType = String(metadata.contentType ?? "").toLowerCase();
    const dimensions = imageDimensions(buffer);
    if (
      !kind || (declaredType && declaredType !== kind)
      || buffer.length <= 0 || buffer.length > MAX_IMAGE_BYTES
      || (Number(metadata.size) > 0 && Number(metadata.size) !== buffer.length)
      || !dimensions || dimensions.width < 256 || dimensions.height < 256
      || dimensions.width > 8192 || dimensions.height > 8192
    ) {
      throw new Error("invalid image");
    }
    await perceptualFingerprint(buffer, "image");
    contentHash = fingerprint(buffer);
    contentType = kind;
    sourceBuffer = buffer;
  } catch (error) {
    if ((error as { forbidden?: boolean }).forbidden) {
      throw Object.assign(new Error("The uploaded image is unavailable."), { status: 404, code: "SOURCE_NOT_FOUND" });
    }
    throw Object.assign(new Error("Use a readable JPEG, PNG, or WebP image between 256 and 8192 pixels and up to 15 MB."), {
      status: 422,
      code: "INVALID_SOURCE_IMAGE",
    });
  }
  return {
    requestSource: source,
    objectPath,
    contentHash,
    contentType: contentType!,
    buffer: sourceBuffer!,
    imageAssetId,
  };
}

function canonicalPlan(input: CommonInput, approvedPrompt: string, objectPath: string, sourceContentHash: string): string {
  return JSON.stringify({
    version: 1,
    source: input.source,
    sourceObjectPath: objectPath,
    sourceContentHash,
    prompt: approvedPrompt,
    durationSeconds: input.durationSeconds,
    provider: input.provider,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
  });
}

function fingerprint(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function buildPlan(input: CommonInput, userId: string) {
  if (!photoAnimationProviderAvailable(input.provider)) {
    throw Object.assign(new Error(`${input.provider} animation is not configured.`), {
      status: 503,
      code: "PROVIDER_UNAVAILABLE",
    });
  }
  const assessment = assessGeneratedMediaPrompt(input.prompt);
  if (assessment.status === "blocked") {
    throw Object.assign(new Error(assessment.reason ?? "This prompt is not supported."), {
      status: 422,
      code: "PROMPT_BLOCKED",
    });
  }
  const source = await resolveAndValidateSource(input.source, userId);
  const videoCredits = calculateCreditCost(
    String(input.durationSeconds),
    input.resolution,
    input.durationSeconds,
    input.provider,
    "narrative",
  );
  const prompt = assessment.safePrompt;
  return {
    source,
    prompt,
    videoCredits,
    planFingerprint: fingerprint(canonicalPlan(input, prompt, source.objectPath, source.contentHash)),
  };
}

function sendError(res: Parameters<Parameters<typeof router.post>[1]>[1], error: unknown): void {
  const detail = error as { status?: number; code?: string; message?: string };
  if (!detail.status) {
    res.status(500).json({ error: "Unable to prepare the photo animation.", code: "INTERNAL_ERROR" });
    return;
  }
  res.status(detail.status ?? 500).json({
    error: detail.message ?? "Unable to prepare the photo animation.",
    ...(detail.code ? { code: detail.code } : {}),
  });
}

router.post("/photo-animations/quote", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = commonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid photo animation request.", code: "INVALID_REQUEST" });
    return;
  }
  try {
    const plan = await buildPlan(parsed.data, req.user.id);
    res.json({
      totalCredits: plan.videoCredits,
      videoCredits: plan.videoCredits,
      imageCredits: 0,
      prompt: plan.prompt,
      planFingerprint: plan.planFingerprint,
      durationSeconds: parsed.data.durationSeconds,
      provider: parsed.data.provider,
      resolution: parsed.data.resolution,
      aspectRatio: parsed.data.aspectRatio,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/photo-animations", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: req.body?.approved === true ? "Invalid photo animation request." : "Approve the quoted animation before submitting.",
      code: req.body?.approved === true ? "INVALID_REQUEST" : "APPROVAL_REQUIRED",
    });
    return;
  }
  try {
    const input: CommonInput = {
      source: parsed.data.source,
      prompt: parsed.data.prompt,
      durationSeconds: parsed.data.durationSeconds,
      provider: parsed.data.provider,
      resolution: parsed.data.resolution,
      aspectRatio: parsed.data.aspectRatio,
    };
    const plan = await buildPlan(input, req.user.id);
    if (parsed.data.expectedCredits !== plan.videoCredits) {
      res.status(409).json({ error: "The animation price changed. Request a new quote.", code: "STALE_PRICE" });
      return;
    }
    if (parsed.data.planFingerprint !== plan.planFingerprint) {
      res.status(409).json({ error: "The approved animation plan changed. Request a new quote.", code: "STALE_PLAN" });
      return;
    }

    await db.insert(creditsTable).values({ id: randomUUID(), userId: req.user.id })
      .onConflictDoNothing({ target: creditsTable.userId });
    const requestHash = fingerprint(canonicalPlan(input, plan.prompt, plan.source.objectPath, plan.source.contentHash));
    const jobId = `pa_${fingerprint(`${req.user.id}:${parsed.data.idempotencyKey}`).slice(0, 48)}`;
    const retainedSourcePath = await storage.uploadPhotoAnimationSourceBuffer(
      plan.source.buffer,
      `${jobId}-${plan.source.contentHash}`,
      plan.source.contentType,
    );
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, req.user.id)).limit(1).for("update");
      if (!user) return { kind: "unauthorized" as const };
      const admin = Boolean(process.env.ADMIN_EMAIL && user.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
      if (!admin && user.subscriptionStatus !== "active") return { kind: "subscription" as const };

      const duplicate = await tx.execute<{ id: string; status: string; requestHash: string }>(sql`
        SELECT id, status, manifest->'photoAnimation'->>'requestHash' AS "requestHash"
        FROM jobs
        WHERE user_id = ${req.user.id}
          AND manifest->'photoAnimation'->>'operationKey' = ${parsed.data.idempotencyKey}
        LIMIT 1
      `);
      const existing = duplicate.rows[0];
      if (existing) {
        return existing.requestHash === requestHash
          ? { kind: "existing" as const, id: existing.id, status: existing.status }
          : { kind: "mismatch" as const };
      }

      if (plan.source.imageAssetId) {
        const [lockedAsset] = await tx.select({ id: imageAssetsTable.id })
          .from(imageAssetsTable).where(and(
            eq(imageAssetsTable.id, plan.source.imageAssetId),
            eq(imageAssetsTable.userId, req.user.id),
            isNull(imageAssetsTable.deletedAt),
          )).limit(1).for("update");
        if (!lockedAsset) return { kind: "source" as const };
      }
      const [credits] = await tx.select().from(creditsTable)
        .where(eq(creditsTable.userId, req.user.id)).limit(1).for("update");
      if (!credits) throw new Error("Credits account unavailable.");
      if (credits.creditsRemaining < plan.videoCredits) {
        return { kind: "credits" as const, remaining: credits.creditsRemaining };
      }
      const subscriptionDebit = Math.min(plan.videoCredits, Math.max(0, credits.subscriptionCredits));
      const topupDebit = Math.min(plan.videoCredits - subscriptionDebit, Math.max(0, credits.topupCredits));
      await tx.update(creditsTable).set({
        subscriptionCredits: sql`GREATEST(subscription_credits - ${plan.videoCredits}, 0)`,
        topupCredits: sql`GREATEST(topup_credits - GREATEST(${plan.videoCredits} - subscription_credits, 0), 0)`,
        creditsRemaining: sql`GREATEST(credits_remaining - ${plan.videoCredits}, 0)`,
        creditsUsed: sql`credits_used + ${plan.videoCredits}`,
        updatedAt: new Date(),
      }).where(eq(creditsTable.userId, req.user.id));
      await tx.insert(jobsTable).values({
        id: jobId,
        userId: req.user.id,
        jobType: "ai",
        status: "queued",
        prompt: plan.prompt,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        referenceImagePath: retainedSourcePath,
        requestedDuration: String(input.durationSeconds),
        aiProvider: input.provider,
        progressPercent: 0,
        manifest: {
          reservedCredits: plan.videoCredits,
          reservedSubscriptionCredits: subscriptionDebit,
          reservedTopupCredits: topupDebit,
          generationMode: "narrative",
          narrativeVisualSource: "video",
          photoAnimation: {
            version: 1,
            operationKey: parsed.data.idempotencyKey,
            requestHash,
            planFingerprint: plan.planFingerprint,
            approved: true,
            approvedPrompt: plan.prompt,
            source: input.source,
            sourceObjectPath: retainedSourcePath,
            originalSourceObjectPath: plan.source.objectPath,
            sourceContentHash: plan.source.contentHash,
            durationSeconds: input.durationSeconds,
          },
          storyboard: {
            generationMode: "narrative",
            numClips: 1,
            clipDurationSec: input.durationSeconds,
            targetOutputDuration: input.durationSeconds,
            shots: [{
              index: 0,
              label: "photo animation",
              startTime: 0,
              energy: 0.5,
              usesCharacterReference: true,
              prompt: plan.prompt,
            }],
            timeline: [0],
          },
        },
      });
      return { kind: "created" as const, id: jobId, status: "queued" };
    });

    if (result.kind === "unauthorized") res.status(401).json({ error: "Account not found." });
    else if (result.kind === "subscription") res.status(403).json({ error: "A subscription is required to create videos.", code: "SUBSCRIPTION_REQUIRED" });
    else if (result.kind === "mismatch") res.status(409).json({ error: "This idempotency key was used for a different request.", code: "IDEMPOTENCY_MISMATCH" });
    else if (result.kind === "source") res.status(409).json({ error: "The selected image was deleted before submission.", code: "SOURCE_CHANGED" });
    else if (result.kind === "credits") res.status(402).json({ error: "Insufficient credits.", code: "INSUFFICIENT_CREDITS", creditsRequired: plan.videoCredits, creditsRemaining: result.remaining });
    else res.status(result.kind === "created" ? 201 : 200).json({ id: result.id, status: result.status });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/photo-animations/operations/:idempotencyKey", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = z.string().uuid().safeParse(req.params.idempotencyKey);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid operation key.", code: "INVALID_OPERATION_KEY" });
    return;
  }
  try {
    const operation = await db.transaction(async (tx) => {
      // Serialize with POST's user-row lock. If POST has reached its reservation
      // transaction, this lookup waits for commit/rollback instead of reporting
      // a false absence during the commit race.
      const [user] = await tx.select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, req.user.id))
        .limit(1)
        .for("update");
      if (!user) return null;
      const result = await tx.execute<{ id: string; status: string }>(sql`
        SELECT id, status
        FROM jobs
        WHERE user_id = ${req.user.id}
          AND manifest->'photoAnimation'->>'operationKey' = ${parsed.data}
        LIMIT 1
      `);
      return result.rows[0] ?? null;
    });
    if (!operation) {
      res.status(404).json({
        code: "OPERATION_NOT_FOUND",
        error: "No photo animation operation was found for that key.",
      });
      return;
    }
    res.json({ id: operation.id, status: operation.status });
  } catch {
    res.status(500).json({ error: "Unable to look up the photo animation operation.", code: "INTERNAL_ERROR" });
  }
});

export default router;