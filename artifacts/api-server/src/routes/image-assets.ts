import { Router } from "express";
import { randomUUID } from "crypto";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  creditsTable,
  db,
  imageAssetsTable,
  jobsTable,
  usersTable,
} from "@workspace/db";
import { getUserTier } from "../lib/tier.js";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "../lib/creditCost.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();
const MAX_IMAGE_PACK_COUNT = 30;

const createImagePackBody = z.object({
  prompt: z.string().trim().min(1).max(1000),
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
});

router.post("/image-packs", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = createImagePackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: `Provide a visual prompt and choose between 1 and ${MAX_IMAGE_PACK_COUNT} images.`,
    });
    return;
  }

  const { prompt, style, imageCount, aspectRatio } = parsed.data;
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
  if (!isAdmin && user.subscriptionStatus !== "active") {
    res.status(403).json({
      error: "A subscription is required to generate an image pack.",
      code: "SUBSCRIPTION_REQUIRED",
    });
    return;
  }

  // Keep tier lookup on this flow too: it validates the subscription record
  // against the same source used by video generation, without changing the
  // product-wide access policy.
  if (!isAdmin) await getUserTier(user);

  const creditCost = imageCount * GENERATED_IMAGE_CREDITS_PER_VISUAL;
  await db
    .insert(creditsTable)
    .values({ id: randomUUID(), userId: req.user.id })
    .onConflictDoNothing({ target: creditsTable.userId });

  const jobId = randomUUID();
  const reservation = await db.transaction(async (tx) => {
    const [credits] = await tx
      .select()
      .from(creditsTable)
      .where(eq(creditsTable.userId, req.user.id))
      .limit(1)
      .for("update");
    if (!credits) throw new Error("Credits account unavailable.");
    if (!isAdmin && credits.creditsRemaining < creditCost) {
      return { job: null, remaining: credits.creditsRemaining };
    }

    const subscriptionDebit = Math.min(creditCost, Math.max(0, credits.subscriptionCredits));
    const topupDebit = Math.min(
      Math.max(0, creditCost - subscriptionDebit),
      Math.max(0, credits.topupCredits),
    );
    await tx
      .update(creditsTable)
      .set({
        subscriptionCredits: sql`GREATEST(subscription_credits - ${creditCost}, 0)`,
        topupCredits: sql`GREATEST(topup_credits - GREATEST(${creditCost} - subscription_credits, 0), 0)`,
        creditsRemaining: sql`GREATEST(credits_remaining - ${creditCost}, 0)`,
        creditsUsed: sql`credits_used + ${creditCost}`,
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
        requestedDuration: String(imageCount),
        progressPercent: 0,
        manifest: {
          reservedCredits: creditCost,
          reservedSubscriptionCredits: subscriptionDebit,
          reservedTopupCredits: topupDebit,
          imagePack: { imageCount },
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
    .set({ deletedAt: new Date() })
    .where(eq(imageAssetsTable.id, asset.id));
  await new ObjectStorageService().deleteObject(asset.objectPath).catch(() => {});
  res.status(204).end();
});

export default router;