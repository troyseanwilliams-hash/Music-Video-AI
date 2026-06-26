import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, creditsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  calculateEditorCost,
  EDITOR_FREE_MAX_SECONDS,
  EDITOR_FREE_RESOLUTION,
} from "../lib/editorCost.js";

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
  const isPaid = isAdmin || (userRecord?.subscriptionStatus ?? "none") === "active";

  // Approximate timeline length (sum of segment durations).
  const totalDuration = input.segments.reduce((s, seg) => s + (seg.durationSec || 0), 0);
  const hasTransitions = !!input.transition && input.transition.type !== "none";

  // Enforce tier server-side. Free users get a watermark + limits and pay nothing.
  let resolution = input.resolution;
  let transition = input.transition;
  let watermark = false;

  if (!isPaid) {
    watermark = true;
    resolution = EDITOR_FREE_RESOLUTION as "720p";
    transition = { type: "none", durationSec: 0.5 };
    if (totalDuration > EDITOR_FREE_MAX_SECONDS) {
      res.status(403).json({
        error: `Free exports are limited to ${EDITOR_FREE_MAX_SECONDS}s. Upgrade to export longer videos without a watermark.`,
        code: "UPGRADE_REQUIRED",
        maxSeconds: EDITOR_FREE_MAX_SECONDS,
      });
      return;
    }
  }

  // Paid renders: estimate cost and check the balance (deducted on success).
  let creditCost = 0;
  if (!watermark && !isAdmin) {
    creditCost = calculateEditorCost({
      durationSec: totalDuration,
      resolution,
      hasTransitions,
    });

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
        error: `This export costs ${creditCost} credits but you have ${userCredits.creditsRemaining}.`,
        code: "INSUFFICIENT_CREDITS",
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
    watermark,
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
    { userId: req.user.id, jobId, totalDuration, creditCost, watermark, isPaid },
    "Studio render queued",
  );

  res.status(201).json({ job, estimatedCost: creditCost, watermark });
});

export default router;
