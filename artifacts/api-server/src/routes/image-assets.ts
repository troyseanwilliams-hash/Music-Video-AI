import { Router } from "express";
import { randomUUID } from "crypto";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  creditsTable,
  db,
  lockActiveCredits,
  splitCreditDebit,
  debitCreditColumns,
  imageAssetLikesTable,
  imageAssetsTable,
  jobsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateImagePackBody,
  GetPublicImageAssetParams,
  GetPublicImageAssetResponse,
  LikeImageAssetParams,
  LikeImageAssetResponse,
  ListPublicImageAssetsQueryParams,
  ListPublicImageAssetsResponse,
  PlanImagePackBody,
  PlanImagePackResponse,
  UnlikeImageAssetParams,
  UnlikeImageAssetResponse,
  UpdateImageAssetVisibilityBody,
  UpdateImageAssetVisibilityParams,
  UpdateImageAssetVisibilityResponse,
} from "@workspace/api-zod";
import { getUserTier } from "../lib/tier.js";
import { canCreateCreditFundedMediaWithPurchases } from "../lib/paidCreditEntitlement.js";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "../lib/creditCost.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import {
  hasNumberedImagePackScript,
  parseNumberedImagePackScript,
  planImagePackScenes,
} from "../lib/shotPlan.js";
import { assessGeneratedMediaPrompt } from "../lib/promptSafety.js";

const router = Router();
const MAX_IMAGE_PACK_COUNT = 30;
// Keep the image-pack script limit aligned with Generate's creative prompt
// field. Numbered scripts are intentionally sent intact to the planner so a
// long script does not collapse into an empty confirmation storyboard.
export const MAX_IMAGE_PACK_PROMPT_LENGTH = 12_000;

function isAdminEmail(email?: string | null): boolean {
  return !!(
    process.env.ADMIN_EMAIL
    && email
    && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
}

type PublicImageRow = {
  id: string;
  objectPath: string;
  assetIndex: number;
  style: string | null;
  likeCount: number;
  createdAt: Date;
  creatorName: string | null;
};

export function parsePublicImagePagination(query: unknown) {
  const contract = ListPublicImageAssetsQueryParams.safeParse(query);
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(60).default(24),
  }).safeParse(query);
  if (!contract.success || !parsed.success) return null;
  return {
    page: parsed.data.page,
    limit: parsed.data.limit,
  };
}

/** Public DTO allowlist. Keep prompts, job IDs, and owner IDs out by construction. */
export function toPublicImageAsset(row: PublicImageRow, liked: boolean) {
  return {
    id: row.id,
    objectPath: row.objectPath,
    assetIndex: row.assetIndex,
    style: row.style,
    likeCount: row.likeCount,
    liked,
    creatorName: row.creatorName,
    createdAt: row.createdAt,
  };
}

const createImagePackBody = z.object({
  prompt: z.string().trim().min(1).max(MAX_IMAGE_PACK_PROMPT_LENGTH),
  style: z.enum([
    "realistic",
    "anime",
    "cinematic",
    "abstract",
    "neon",
    "vintage",
    "fantasy",
    "documentary",
  ]).optional(),
  imageCount: z.coerce.number().int().min(1).max(MAX_IMAGE_PACK_COUNT),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  // The path kind and access policy are checked against storage/database below.
  // Keep this boundary schema limited to the transport shape so generated
  // gallery paths can reach that authorization check.
  referenceImagePath: z.string().trim().min(1).max(500).nullable().optional(),
  approvedScenes: z.array(z.object({
    index: z.coerce.number().int().min(0),
    prompt: z.string().trim().min(1).max(1000),
  })).min(1).max(MAX_IMAGE_PACK_COUNT).optional(),
});

type ApprovedImageScene = { index: number; prompt: string };

type ImagePackReferenceKind = "upload" | "gallery";

type GeneratedImageReference = {
  userId: string;
  isPublic: boolean;
  deletedAt: Date | null;
};

type ImagePackReferenceValidation =
  | { ok: true; kind: ImagePackReferenceKind }
  | { ok: false; status: 400 | 403; code: string; error: string };

/**
 * Image-pack references are intentionally narrower than arbitrary object
 * entities. Uploads remain supported, while generated gallery paths must be
 * backed by an image_assets row so an opaque storage path cannot be used as an
 * authorization bypass.
 */
export function classifyImagePackReferencePath(
  objectPath: string,
): ImagePackReferenceKind | null {
  if (!objectPath.startsWith("/objects/")) return null;
  const segments = objectPath.slice("/objects/".length).split("/");
  if (
    segments.length < 2
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  if (segments[0] === "uploads") return "upload";
  if (segments[0] === "image-packs" || segments[0] === "narrative-images") return "gallery";
  return null;
}

export function canUseGeneratedImageReference(
  asset: GeneratedImageReference | null | undefined,
  userId: string,
): boolean {
  return Boolean(
    asset
    && !asset.deletedAt
    && (asset.userId === userId || asset.isPublic),
  );
}

async function validateImagePackReferencePath(
  objectPath: string,
  userId: string,
): Promise<ImagePackReferenceValidation> {
  const kind = classifyImagePackReferencePath(objectPath);
  if (!kind) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REFERENCE_IMAGE_PATH",
      error: "referenceImagePath must point to an uploaded image or an authorized generated gallery image.",
    };
  }

  if (kind === "upload") {
    const segments = objectPath.slice("/objects/".length).split("/");
    // New uploads are namespaced by user ID. Keep accepting legacy
    // /objects/uploads/<opaque-id> paths, but do not let a user select another
    // account's owner-scoped upload.
    if (segments.length > 2 && segments[1] !== userId) {
      return {
        ok: false,
        status: 403,
        code: "REFERENCE_IMAGE_FORBIDDEN",
        error: "You do not have access to the selected uploaded reference image.",
      };
    }
  }

  if (kind === "gallery") {
    const [asset] = await db
      .select({
        userId: imageAssetsTable.userId,
        isPublic: imageAssetsTable.isPublic,
        deletedAt: imageAssetsTable.deletedAt,
      })
      .from(imageAssetsTable)
      .where(and(
        eq(imageAssetsTable.objectPath, objectPath),
        isNull(imageAssetsTable.deletedAt),
        or(
          eq(imageAssetsTable.userId, userId),
          eq(imageAssetsTable.isPublic, true),
        ),
      ))
      .limit(1);
    if (!asset || !canUseGeneratedImageReference(asset, userId)) {
      return {
        ok: false,
        status: 403,
        code: "REFERENCE_IMAGE_FORBIDDEN",
        error: "You do not have access to the selected generated gallery image.",
      };
    }
  }

  try {
    await new ObjectStorageService().getObjectEntityFile(objectPath);
  } catch {
    return {
      ok: false,
      status: 400,
      code: "REFERENCE_IMAGE_UNAVAILABLE",
      error: "The selected reference image is no longer available. Upload it again and retry.",
    };
  }
  return { ok: true, kind };
}

export function formatImagePackValidationError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "request";
    return `${field}: ${issue.message}`;
  });
  return issues.length > 0
    ? `Invalid image pack request (${issues.join("; ")}).`
    : "Invalid image pack request.";
}

export function buildImagePackPlan(input: {
  prompt: string;
  style?: string | null;
  imageCount: number;
  hasCharacterReference: boolean;
}): ApprovedImageScene[] {
  const numberedScript = parseNumberedImagePackScript(input.prompt);
  if (hasNumberedImagePackScript(input.prompt) && !numberedScript) {
    throw new Error("Number every scene consecutively from 1, with exactly one complete scene on each line.");
  }
  if (numberedScript) {
    if (numberedScript.scenes.length !== input.imageCount) {
      throw new Error(`Your script contains ${numberedScript.scenes.length} numbered scenes. Set Images to generate to ${numberedScript.scenes.length} so every line produces exactly one image.`);
    }
  }
  return planImagePackScenes(input).map((scene) => ({
    index: scene.index,
    prompt: scene.prompt.trim(),
  }));
}

export function validateApprovedImageScenes(
  scenes: ApprovedImageScene[],
  imageCount: number,
): ApprovedImageScene[] {
  if (scenes.length !== imageCount) {
    throw new Error(`Approve exactly ${imageCount} scenes before creating this image pack.`);
  }
  const uniquePrompts = new Set<string>();
  return scenes.map((scene, expectedIndex) => {
    if (!Number.isInteger(scene.index) || scene.index !== expectedIndex) {
      throw new Error("Approved scenes must be in unique chronological order starting at 0.");
    }
    const prompt = scene.prompt.trim();
    if (!prompt || prompt.length > 1000) {
      throw new Error("Each approved scene prompt must be between 1 and 1000 characters.");
    }
    const fingerprint = prompt.replace(/\s+/g, " ").toLocaleLowerCase();
    if (uniquePrompts.has(fingerprint)) throw new Error("Approved scene prompts must be unique.");
    uniquePrompts.add(fingerprint);
    return { index: scene.index, prompt };
  });
}

export function assessImagePackScenes(scenes: ApprovedImageScene[]):
  | { ok: true; scenes: ApprovedImageScene[] }
  | { ok: false; index: number; reason: string } {
  const safeScenes: ApprovedImageScene[] = [];
  for (const scene of scenes) {
    const assessment = assessGeneratedMediaPrompt(scene.prompt);
    if (assessment.status === "blocked") {
      return {
        ok: false,
        index: scene.index,
        reason: assessment.reason ?? "This content is not supported.",
      };
    }
    safeScenes.push({ ...scene, prompt: assessment.safePrompt });
  }
  return { ok: true, scenes: safeScenes };
}

export function toPersistedImagePackScenes(
  scenes: ApprovedImageScene[],
  referenceImagePath?: string | null,
) {
  const usesCharacterReference = Boolean(referenceImagePath);
  return scenes.map((scene) => ({
    ...scene,
    label: `scene ${scene.index + 1}`,
    startTime: scene.index * 10,
    energy: 0.6,
    // Both server and worker processors only send referenceImagePath to the
    // provider when this intent flag is true. A supplied pack-level reference
    // must therefore be carried into every approved scene.
    usesCharacterReference,
  }));
}

router.post("/image-packs", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const contract = CreateImagePackBody.safeParse(req.body);
  if (!contract.success) {
    res.status(400).json({
      error: formatImagePackValidationError(contract.error),
    });
    return;
  }
  const parsed = createImagePackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: formatImagePackValidationError(parsed.error),
    });
    return;
  }

  const { prompt, style, imageCount, aspectRatio, referenceImagePath, approvedScenes } = parsed.data;
  let scenes: ApprovedImageScene[];
  try {
    scenes = approvedScenes
      ? validateApprovedImageScenes(approvedScenes, imageCount)
      : buildImagePackPlan({ prompt, style, imageCount, hasCharacterReference: Boolean(referenceImagePath) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid approved image scenes." });
    return;
  }
  const sceneAssessment = assessImagePackScenes(scenes);
  if (!sceneAssessment.ok) {
    res.status(422).json({
      error: `Scene ${sceneAssessment.index + 1} contains unsupported content. ${sceneAssessment.reason} Edit the scene and try again.`,
      code: "PROMPT_BLOCKED",
    });
    return;
  }
  scenes = sceneAssessment.scenes;
  if (referenceImagePath) {
    const referenceValidation = await validateImagePackReferencePath(referenceImagePath, req.user.id);
    if (!referenceValidation.ok) {
      res.status(referenceValidation.status).json({
        error: referenceValidation.error,
        code: referenceValidation.code,
      });
      return;
    }
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "Account not found." });
    return;
  }
  const isAdmin =
    !!process.env.ADMIN_EMAIL
    && user.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();
  if (!isAdmin && !(await canCreateCreditFundedMediaWithPurchases(db, user))) {
    res.status(403).json({
      error: "An active plan, trial, or purchased credit pack is required to generate an image pack.",
      code: "SUBSCRIPTION_REQUIRED",
    });
    return;
  }

  // Keep tier lookup on this flow too: it validates the subscription record
  // against the same source used by video generation, without changing the
  // product-wide access policy.
  if (!isAdmin && user.subscriptionStatus === "active") await getUserTier(user);

  const creditCost = imageCount * GENERATED_IMAGE_CREDITS_PER_VISUAL;
  await db
    .insert(creditsTable)
    .values({ id: randomUUID(), userId: req.user.id })
    .onConflictDoNothing({ target: creditsTable.userId });

  const jobId = randomUUID();
  const reservation = await db.transaction(async (tx) => {
    const credits = await lockActiveCredits(tx, req.user.id);
    if (!credits) throw new Error("Credits account unavailable.");
    if (credits.creditsRemaining < creditCost) {
      return { job: null, remaining: credits.creditsRemaining };
    }

    const split = splitCreditDebit(credits, creditCost);
    const subscriptionDebit = split.subscription;
    const topupDebit = split.topup;
    await tx
      .update(creditsTable)
      .set({
        ...debitCreditColumns(split, creditCost),
        updatedAt: new Date(),
      })
      .where(eq(creditsTable.userId, req.user.id));

    const [job] = await tx
      .insert(jobsTable)
      .values({
        id: jobId,
        userId: req.user.id,
        jobType: "image_pack",
        status: "queued",
        prompt,
        style,
        aspectRatio,
        referenceImagePath: referenceImagePath ?? null,
        requestedDuration: String(imageCount),
        progressPercent: 0,
        manifest: {
          reservedCredits: creditCost,
          reservedSubscriptionCredits: subscriptionDebit,
          reservedWelcomeCredits: split.welcome,
          reservedTopupCredits: topupDebit,
          imagePack: {
            imageCount,
            referenceImagePath: referenceImagePath ?? null,
            scenes: toPersistedImagePackScenes(scenes, referenceImagePath),
          },
        },
      })
      .returning();
    return { job, remaining: credits.creditsRemaining - creditCost };
  });

  if (!reservation.job) {
    res.status(402).json({
      error: `Insufficient credits — this image pack costs ${creditCost} credits but you have ${reservation.remaining} remaining.`,
      code: "INSUFFICIENT_CREDITS",
      creditsRequired: creditCost,
      creditsRemaining: reservation.remaining,
    });
    return;
  }

  req.log.info(
    { userId: req.user.id, jobId, imageCount, creditCost },
    "Image pack queued with credits reserved",
  );
  res.status(201).json(reservation.job);
});

router.post("/image-packs/plan", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const contract = PlanImagePackBody.safeParse(req.body);
  if (!contract.success) {
    res.status(400).json({
      error: formatImagePackValidationError(contract.error),
    });
    return;
  }
  const parsed = createImagePackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: formatImagePackValidationError(parsed.error),
    });
    return;
  }
  const { prompt, style, imageCount, referenceImagePath } = parsed.data;
  if (referenceImagePath) {
    const referenceValidation = await validateImagePackReferencePath(referenceImagePath, req.user.id);
    if (!referenceValidation.ok) {
      res.status(referenceValidation.status).json({
        error: referenceValidation.error,
        code: referenceValidation.code,
      });
      return;
    }
  }
  try {
    const scenes = buildImagePackPlan({
      prompt,
      style,
      imageCount,
      hasCharacterReference: Boolean(referenceImagePath),
    });
    // Planning is deliberately DB-write-free: credits are reserved only by POST /image-packs.
    res.json(PlanImagePackResponse.parse({ scenes }));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Unable to plan image pack scenes.",
    });
  }
});

router.get("/image-assets", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(60).default(30),
    jobId: z.string().uuid().optional(),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid generated-image query." });
    return;
  }
  const { page, limit, jobId } = parsed.data;
  const where = and(
    eq(imageAssetsTable.userId, req.user.id),
    isNull(imageAssetsTable.deletedAt),
    jobId ? eq(imageAssetsTable.jobId, jobId) : undefined,
  );
  const [assets, total] = await Promise.all([
    db
      .select()
      .from(imageAssetsTable)
      .where(where)
      .orderBy(desc(imageAssetsTable.createdAt), desc(imageAssetsTable.assetIndex))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ count: count() }).from(imageAssetsTable).where(where),
  ]);
  res.json({ assets, total: total[0]?.count ?? 0, page, limit });
});

const publicImageSelection = {
  id: imageAssetsTable.id,
  objectPath: imageAssetsTable.objectPath,
  assetIndex: imageAssetsTable.assetIndex,
  style: imageAssetsTable.style,
  likeCount: imageAssetsTable.likeCount,
  createdAt: imageAssetsTable.createdAt,
  creatorName: sql<string | null>`CASE
    WHEN ${imageAssetsTable.isCreatorAnonymous} THEN 'Anonymous'
    ELSE ${usersTable.firstName}
  END`,
};

router.get("/image-gallery", async (req, res): Promise<void> => {
  const pagination = parsePublicImagePagination(req.query);
  if (!pagination) {
    res.status(400).json({ error: "Invalid public generated-image query." });
    return;
  }
  const { page, limit } = pagination;
  const publicOnly = and(eq(imageAssetsTable.isPublic, true), isNull(imageAssetsTable.deletedAt));
  const [rows, totalResult] = await Promise.all([
    db
      .select(publicImageSelection)
      .from(imageAssetsTable)
      .leftJoin(usersTable, eq(usersTable.id, imageAssetsTable.userId))
      .where(publicOnly)
      .orderBy(desc(imageAssetsTable.likeCount), desc(imageAssetsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ count: count() }).from(imageAssetsTable).where(publicOnly),
  ]);

  let likedIds = new Set<string>();
  if (req.isAuthenticated() && rows.length > 0) {
    const likes = await db
      .select({ imageAssetId: imageAssetLikesTable.imageAssetId })
      .from(imageAssetLikesTable)
      .where(and(
        eq(imageAssetLikesTable.userId, req.user.id),
        inArray(imageAssetLikesTable.imageAssetId, rows.map((row) => row.id)),
      ));
    likedIds = new Set(likes.map((like) => like.imageAssetId));
  }
  res.json(ListPublicImageAssetsResponse.parse({
    assets: rows.map((row) => toPublicImageAsset(row, likedIds.has(row.id))),
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  }));
});

router.get("/image-gallery/:id", async (req, res): Promise<void> => {
  const params = GetPublicImageAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Generated image not found." });
    return;
  }
  const [row] = await db
    .select(publicImageSelection)
    .from(imageAssetsTable)
    .leftJoin(usersTable, eq(usersTable.id, imageAssetsTable.userId))
    .where(and(
      eq(imageAssetsTable.id, params.data.id),
      eq(imageAssetsTable.isPublic, true),
      isNull(imageAssetsTable.deletedAt),
    ))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Generated image not found." });
    return;
  }
  let liked = false;
  if (req.isAuthenticated()) {
    const [like] = await db
      .select({ imageAssetId: imageAssetLikesTable.imageAssetId })
      .from(imageAssetLikesTable)
      .where(and(
        eq(imageAssetLikesTable.userId, req.user.id),
        eq(imageAssetLikesTable.imageAssetId, row.id),
      ))
      .limit(1);
    liked = Boolean(like);
  }
  res.json(GetPublicImageAssetResponse.parse(toPublicImageAsset(row, liked)));
});

router.patch("/image-assets/:id/visibility", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = UpdateImageAssetVisibilityParams.safeParse(req.params);
  const body = UpdateImageAssetVisibilityBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid generated-image visibility request." });
    return;
  }
  const [asset] = await db
    .select()
    .from(imageAssetsTable)
    .where(and(eq(imageAssetsTable.id, params.data.id), isNull(imageAssetsTable.deletedAt)))
    .limit(1);
  if (!asset) {
    res.status(404).json({ error: "Generated image not found." });
    return;
  }
  if (asset.userId !== req.user.id) {
    const [user] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, req.user.id))
      .limit(1);
    if (!isAdminEmail(user?.email)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  const [updated] = await db
    .update(imageAssetsTable)
    .set({
      isPublic: body.data.isPublic,
      ...(body.data.isCreatorAnonymous === undefined
        ? {}
        : { isCreatorAnonymous: body.data.isCreatorAnonymous }),
    })
    .where(eq(imageAssetsTable.id, asset.id))
    .returning({
      isPublic: imageAssetsTable.isPublic,
      isCreatorAnonymous: imageAssetsTable.isCreatorAnonymous,
    });
  req.log.info(
    { imageAssetId: asset.id, actorUserId: req.user.id, isPublic: body.data.isPublic },
    "Generated image visibility updated",
  );
  res.json(UpdateImageAssetVisibilityResponse.parse({
    id: asset.id,
    isPublic: updated?.isPublic ?? body.data.isPublic,
    isCreatorAnonymous: updated?.isCreatorAnonymous ?? asset.isCreatorAnonymous,
  }));
});

router.post("/image-assets/:id/like", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = LikeImageAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Generated image not found." });
    return;
  }
  const [asset] = await db
    .select({ id: imageAssetsTable.id })
    .from(imageAssetsTable)
    .where(and(
      eq(imageAssetsTable.id, params.data.id),
      eq(imageAssetsTable.isPublic, true),
      isNull(imageAssetsTable.deletedAt),
    ))
    .limit(1);
  if (!asset) {
    res.status(404).json({ error: "Generated image not found." });
    return;
  }
  const likeCount = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(imageAssetLikesTable)
      .values({ userId: req.user.id, imageAssetId: asset.id })
      .onConflictDoNothing()
      .returning({ imageAssetId: imageAssetLikesTable.imageAssetId });
    if (inserted.length > 0) {
      await tx
        .update(imageAssetsTable)
        .set({ likeCount: sql`${imageAssetsTable.likeCount} + 1` })
        .where(eq(imageAssetsTable.id, asset.id));
    }
    const [current] = await tx
      .select({ likeCount: imageAssetsTable.likeCount })
      .from(imageAssetsTable)
      .where(eq(imageAssetsTable.id, asset.id))
      .limit(1);
    return current?.likeCount ?? 0;
  });
  res.json(LikeImageAssetResponse.parse({ liked: true, likeCount }));
});

router.delete("/image-assets/:id/like", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = UnlikeImageAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Generated image not found." });
    return;
  }
  const [asset] = await db
    .select({ id: imageAssetsTable.id })
    .from(imageAssetsTable)
    .where(and(
      eq(imageAssetsTable.id, params.data.id),
      eq(imageAssetsTable.isPublic, true),
      isNull(imageAssetsTable.deletedAt),
    ))
    .limit(1);
  if (!asset) {
    res.status(404).json({ error: "Generated image not found." });
    return;
  }
  const likeCount = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(imageAssetLikesTable)
      .where(and(
        eq(imageAssetLikesTable.userId, req.user.id),
        eq(imageAssetLikesTable.imageAssetId, asset.id),
      ))
      .returning({ imageAssetId: imageAssetLikesTable.imageAssetId });
    if (deleted.length > 0) {
      await tx
        .update(imageAssetsTable)
        .set({ likeCount: sql`GREATEST(${imageAssetsTable.likeCount} - 1, 0)` })
        .where(eq(imageAssetsTable.id, asset.id));
    }
    const [current] = await tx
      .select({ likeCount: imageAssetsTable.likeCount })
      .from(imageAssetsTable)
      .where(eq(imageAssetsTable.id, asset.id))
      .limit(1);
    return current?.likeCount ?? 0;
  });
  res.json(UnlikeImageAssetResponse.parse({ liked: false, likeCount }));
});

router.delete("/image-assets/:id", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid image asset." });
    return;
  }
  const [asset] = await db
    .select()
    .from(imageAssetsTable)
    .where(and(
      eq(imageAssetsTable.id, id.data),
      eq(imageAssetsTable.userId, req.user.id),
      isNull(imageAssetsTable.deletedAt),
    ))
    .limit(1);
  if (!asset) {
    res.status(404).json({ error: "Image asset not found." });
    return;
  }
  await db
    .update(imageAssetsTable)
    .set({ deletedAt: new Date(), isPublic: false })
    .where(eq(imageAssetsTable.id, asset.id));
  await new ObjectStorageService().deleteObject(asset.objectPath).catch(() => {});
  res.status(204).end();
});

export default router;