// Admin-only "Pixazo Lip Sync Generator" — a dedicated, single-video test tool
// for one character performing to a chosen segment of a song. Fixed to Pixazo
// for every generation stage; never offers or silently falls back to Runway,
// Kling, or Luma. Completely separate from the public Generate page, which
// this feature does not touch.
//
// Two modes, both Pixazo-only:
//   - Lip Sync ON  -> audio-driven character render through Pixazo's OmniHuman
//                     endpoint.
//   - Lip Sync OFF -> a plain single-clip Pixazo render driven by the character
//                     image + prompt, with the chosen song segment muxed on
//                     afterward as a soundtrack.
//
// Both modes are gated by a capability check BEFORE any credits are reserved
// or a job is created. Completely separate from the public Generate page,
// which this feature does not touch.
//
// See lipsync.ts, videoApis.ts, and jobProcessor.ts for the render path this
// creates a job for.

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, jobsTable, creditsTable, usersTable, lockActiveCredits, splitCreditDebit, debitCreditColumns } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { calculateLipsyncCost, LIPSYNC_MIN_SECONDS, LIPSYNC_MAX_SECONDS } from "../lib/creditCost.js";
import { lipsyncAvailable } from "../lib/lipsync.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function isAdmin(email: string | null | undefined): boolean {
  return !!(
    process.env.ADMIN_EMAIL &&
    email &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
}

// Server-side gate used by every route below -- a copied URL to the frontend
// page is useless to a non-admin because every request it makes lands here.
function requireAdmin(req: Request, res: Response): boolean {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (!isAdmin(req.user.email)) {
    res.status(403).json({ error: "Admin only" });
    return false;
  }
  return true;
}

router.get("/admin/runway-lipsync/status", (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const hasPixazoKey = !!process.env.PIXAZO_API_KEY;
  const lipSyncAvailable = lipsyncAvailable();
  res.json({
    engine: "pixazo",
    hasPixazoKey,
    plainRenderAvailable: hasPixazoKey,
    lipSyncAvailable,
    lipSyncUnavailableReason: lipSyncAvailable
      ? null
      : !hasPixazoKey
        ? "The AI rendering service is not configured."
        : "AI Lip Sync is unavailable.",
    minSeconds: LIPSYNC_MIN_SECONDS,
    maxSeconds: LIPSYNC_MAX_SECONDS,
  });
});

const CreateBody = z.object({
  prompt: z.string().min(3).max(1000),
  character: z.string().max(120).optional(),
  referenceImagePath: z.string().min(1, "A character/reference image is required"),
  audioObjectPath: z.string().min(1).optional(),
  clipStartTime: z.number().min(0).max(3600).default(0),
  durationSeconds: z.number().int().min(LIPSYNC_MIN_SECONDS).max(LIPSYNC_MAX_SECONDS).default(15),
  aspectRatio: z.enum(["16:9", "9:16", "4:3", "1:1", "21:9"]).default("16:9"),
  lipSyncEnabled: z.boolean().default(true),
});

router.post("/admin/runway-lipsync/jobs", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const {
    prompt,
    character,
    referenceImagePath,
    audioObjectPath,
    clipStartTime,
    durationSeconds,
    aspectRatio,
    lipSyncEnabled,
  } = parsed.data;

  if (!process.env.PIXAZO_API_KEY) {
    res.status(503).json({
      error: "The AI rendering service is not configured. This generator does not use a fallback.",
      code: "AI_SERVICE_UNAVAILABLE",
    });
    return;
  }

  // The whole point of "Lip Sync" mode is an audio-driven performance, so it
  // needs a song segment to perform to. Reject before anything is charged.
  if (lipSyncEnabled && !audioObjectPath) {
    res.status(400).json({ error: "Select a song and segment to enable Lip Sync." });
    return;
  }

  // Critical constraint: reject an unsupported capability BEFORE a paid Pixazo
  // request is sent, and never substitute another provider. Checked here, at
  // request time, before any credits are reserved or job row created.
  if (lipSyncEnabled && !lipsyncAvailable()) {
    res.status(503).json({
      error:
        "Audio-driven character Lip Sync is not available on the configured AI service. This generator does not use a fallback.",
      code: "AI_LIPSYNC_UNAVAILABLE",
    });
    return;
  }

  // requireAdmin() above guarantees req.user is set; TS can't narrow across
  // the function boundary, so pin it to a local once.
  const userId = req.user!.id;

  const [userRecord] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  void userRecord;

  // Reserve only active funds; even internal testing cannot silently create
  // a negative balance or revive an expired signup grant.
  const creditCost = calculateLipsyncCost(durationSeconds);
  const credits = await db.select().from(creditsTable).where(eq(creditsTable.userId, userId)).limit(1);
  let userCredits = credits[0];
  if (!userCredits) {
    const [newCredits] = await db.insert(creditsTable).values({ id: randomUUID(), userId }).returning();
    userCredits = newCredits;
  }
  void userCredits;
  const available = await db.transaction((tx) => lockActiveCredits(tx, userId));
  if (!available || available.creditsRemaining < creditCost) {
    res.status(402).json({ error: "Insufficient active credits for this render.", code: "INSUFFICIENT_CREDITS" });
    return;
  }

  const jobId = randomUUID();
  const job = await db.transaction(async (tx) => {
    const active = await lockActiveCredits(tx, userId);
    if (!active || active.creditsRemaining < creditCost) return null;
    const split = splitCreditDebit(active, creditCost);
    await tx
      .update(creditsTable)
      .set({
        ...debitCreditColumns(split, creditCost),
        updatedAt: new Date(),
      })
      .where(eq(creditsTable.userId, userId));

    const [inserted] = await tx
      .insert(jobsTable)
      .values({
        id: jobId,
        userId,
        jobType: "runway_lipsync",
        status: "queued",
        prompt,
        character: character ?? null,
        referenceImagePath,
        audioSourceType: audioObjectPath ? "upload" : null,
        audioObjectPath: audioObjectPath ?? null,
        clipStartTime,
        requestedDuration: String(durationSeconds),
        aspectRatio,
        aiProvider: "pixazo",
        watermark: false,
        // Pixazo-only flag consumed by the admin job processor.
        manifest: {
          reservedCredits: creditCost,
          reservedWelcomeCredits: split.welcome,
          reservedSubscriptionCredits: split.subscription,
          reservedTopupCredits: split.topup,
          provider: "pixazo",
          lipSyncEnabled,
        } as unknown as Record<string, unknown>,
        progressPercent: 0,
      })
      .returning();
    return inserted;
  });
  if (!job) {
    res.status(402).json({ error: "Insufficient active credits for this render.", code: "INSUFFICIENT_CREDITS" });
    return;
  }

  req.log.info(
    { userId, jobId, lipSyncEnabled, durationSeconds, creditCost },
    "Admin Pixazo Lip Sync job queued",
  );
  logger.info({ jobId, lipSyncEnabled }, "Pixazo Lip Sync Generator job created");

  res.status(201).json(job);
});

export default router;
