import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, creditsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod/v4";
import { calculateEditorCost } from "../lib/editorCost.js";

const router = Router();

const SegmentSchema = z.object({
  objectPath: z.string().min(1),
  kind: z.enum(["video", "photo"]),
  durationSec: z.number().positive().max(600),
});

const RenderSchema = z.object({
  name: z.string().max(120).optional(),
  segments: z.array(SegmentSchema).min(1).max(500),
  music: z
    .object({
      objectPath: z.string().min(1),
      mode: z.enum(["mix", "replace"]).default("mix"),
      volume: z.number().min(0).max(1).default(0.6),
    })
    .optional(),
  transition: z
    .object({
      type: z.enum(["none", "crossfade", "fadeblack", "wipe", "slide", "circle"]),
      durationSec: z.number().min(0.2).max(2).default(0.5),
    })
    .optional(),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
});

// POST /api/studio/render — enqueue an editor_render job from a timeline manifest.
router.post("/studio/render", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = RenderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;

  const [userRecord] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  const isAdmin = !!(
    process.env.ADMIN_EMAIL &&
    userRecord?.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
  const isSubscribed = (userRecord?.subscriptionStatus ?? "none") === "active";
  const trialActive =
    !!userRecord?.trialEndsAt && new Date(userRecord.trialEndsAt).getTime() > Date.now();
  // Full, free Editor access during the 7-day trial, with a subscription, or for admins.
  const fullAccess = isAdmin || isSubscribed || trialActive;

  const totalDuration = input.segments.reduce((s, seg) => s + (seg.durationSec || 0), 0);
  const hasTransitions = !!input.transition && input.transition.type !== "none";

  const resolution = input.resolution;
  const transition = input.transition;
  // Once the trial ends and there's no subscription, each export costs credits.
  const chargeCredits = !fullAccess;

  let creditCost = 0;
  if (chargeCredits) {
    creditCost = calculateEditorCost({ durationSec: totalDuration, resolution, hasTransitions });

    let [userCredits] = await db
      .select()
      .from(creditsTable)
      .where(eq(creditsTable.userId, req.user.id))
      .limit(1);
    if (!userCredits) {
      [userCredits] = await db
        .insert(creditsTable)
        .values({ id: randomUUID(), userId: req.user.id })
        .returning();
    }
    if (userCredits.creditsRemaining < creditCost) {
      res.status(402).json({
        error: `Your free trial has ended. Subscribe for unlimited editing — or this export costs ${creditCost} credits (you have ${userCredits.creditsRemaining}).`,
        code: "TRIAL_ENDED",
        creditsRequired: creditCost,
        creditsRemaining: userCredits.creditsRemaining,
      });
      return;
    }
  }

  const manifest = {
    segments: input.segments,
    music: input.music,
    transition,
    resolution,
    watermark: false,
    chargeCredits,
  };

  const jobId = randomUUID();
  const [job] = await db
    .insert(jobsTable)
    .values({
      id: jobId,
      userId: req.user.id,
      jobType: "editor_render",
      manifest: manifest as unknown as Record<string, unknown>,
      status: "queued", // straight into the worker queue — no AI approval step
      prompt: input.name ?? "Studio export",
      progressPercent: 0,
    })
    .returning();

  req.log.info(
    { userId: req.user.id, jobId, totalDuration, creditCost, fullAccess, trialActive },
    "Editor render queued",
  );

  res.status(201).json({ job, estimatedCost: creditCost, charged: chargeCredits });
});

export default router;
