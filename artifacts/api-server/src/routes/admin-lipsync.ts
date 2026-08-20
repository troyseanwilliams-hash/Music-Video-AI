// Admin-only "Runway Lip Sync Generator" — a dedicated, single-video test tool
// for one character performing to a chosen segment of a song. Fixed to Runway
// for every generation stage; never offers or silently falls back to Kling,
// Pixazo, or Luma. Completely separate from the public Generate page, which
// this feature does not touch.
//
// Two modes, both Runway-only:
//   - Lip Sync ON  -> audio-driven character render (generateRunwayCharacterLipsync).
//                     Gated by a real capability check BEFORE any credits are
//                     reserved or a job is created -- if Runway can't do this on
//                     the configured account, the admin sees a clear unavailable
//                     state and nothing is charged or submitted.
//   - Lip Sync OFF -> a plain single-clip Runway render (generateWithRunwayDirect,
//                     same direct-Runway path as the admin Generate page's
//                     preferDirectRunway flow) driven by the character image +
//                     prompt, with the chosen song segment muxed on afterward as
//                     a soundtrack (no audio-driven performance in this mode).
//
// See videoApis.ts (runwayCharacterLipsyncAvailable / generateRunwayCharacterLipsync
// / generateWithRunwayDirect) and jobProcessor.ts (processRunwayLipSyncJob) for
// the render path this creates a job for.

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, jobsTable, creditsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { calculateLipsyncCost, LIPSYNC_MIN_SECONDS, LIPSYNC_MAX_SECONDS } from "../lib/creditCost.js";
import { runwayCharacterLipsyncAvailable } from "../lib/videoApis.js";
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

// What's actually available right now -- drives the UI's unavailable/error
// state before the admin fills out (and pays for) a request. Explicit opt-in
// by design: reads false until an operator sets RUNWAY_LIPSYNC_MODEL, even
// though the real value (gwm1_avatars, Runway's Avatar Videos model) is
// known -- see videoApis.ts generateRunwayCharacterLipsync for the documented
// caveat: it works by creating a throwaway Avatar per request, and the
// "custom avatar" shape it relies on is confirmed for Runway's sibling
// realtime_sessions endpoint but NOT explicitly documented for avatar_videos
// itself. Worth a real test render before relying on it.
router.get("/admin/runway-lipsync/status", (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const hasRunwayKey = !!process.env.RUNWAY_API_KEY;
  const lipSyncAvailable = runwayCharacterLipsyncAvailable();
  res.json({
    engine: "runway",
    hasRunwayKey,
    // Plain (non-lip-sync) Runway rendering just needs the API key.
    plainRenderAvailable: hasRunwayKey,
    lipSyncAvailable,
    lipSyncUnavailableReason: lipSyncAvailable
      ? null
      : !hasRunwayKey
        ? "RUNWAY_API_KEY is not configured."
        : "RUNWAY_LIPSYNC_MODEL is not set. Set it to \"gwm1_avatars\" (Runway's real Avatar Videos model) to enable this -- it creates a throwaway Runway Avatar per request from the character image, then generates an audio-driven video from it. The underlying \"custom avatar\" request shape isn't explicitly documented by Runway for this endpoint (only confirmed for their live-session endpoint), so treat the first render as a real test, not a guarantee.",
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

  if (!process.env.RUNWAY_API_KEY) {
    res.status(503).json({
      error: "RUNWAY_API_KEY is not configured -- this generator only renders via Runway and never falls back to another provider.",
      code: "RUNWAY_UNAVAILABLE",
    });
    return;
  }

  // The whole point of "Lip Sync" mode is an audio-driven performance, so it
  // needs a song segment to perform to. Reject before anything is charged.
  if (lipSyncEnabled && !audioObjectPath) {
    res.status(400).json({ error: "Select a song and segment to enable Lip Sync." });
    return;
  }

  // Critical constraint: reject an unsupported capability BEFORE a paid Runway
  // request is sent, and never substitute another provider. Checked here, at
  // request time, before any credits are reserved or job row created -- so an
  // unavailable capability costs the admin nothing and submits nothing.
  if (lipSyncEnabled && !runwayCharacterLipsyncAvailable()) {
    res.status(503).json({
      error:
        "Runway audio-driven character lip sync isn't available on the configured Runway account/model. Set RUNWAY_LIPSYNC_MODEL to a verified endpoint to enable it -- this never falls back to Pixazo, Kling, or Luma. You can still render without Lip Sync in the meantime.",
      code: "RUNWAY_LIPSYNC_UNAVAILABLE",
    });
    return;
  }

  // requireAdmin() above guarantees req.user is set; TS can't narrow across
  // the function boundary, so pin it to a local once.
  const userId = req.user!.id;

  const [userRecord] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  void userRecord;

  // Admins are still metered (balance floors at 0, creditsUsed still tracks
  // spend) -- same behavior as the main /jobs route -- but are never blocked by
  // an insufficient balance, since this is an internal testing tool.
  const creditCost = calculateLipsyncCost(durationSeconds);
  const credits = await db.select().from(creditsTable).where(eq(creditsTable.userId, userId)).limit(1);
  let userCredits = credits[0];
  if (!userCredits) {
    const [newCredits] = await db.insert(creditsTable).values({ id: randomUUID(), userId }).returning();
    userCredits = newCredits;
  }
  void userCredits;

  const jobId = randomUUID();
  const job = await db.transaction(async (tx) => {
    await tx
      .update(creditsTable)
      .set({
        subscriptionCredits: sql`GREATEST(subscription_credits - ${creditCost}, 0)`,
        topupCredits: sql`GREATEST(topup_credits - GREATEST(${creditCost} - subscription_credits, 0), 0)`,
        creditsRemaining: sql`GREATEST(credits_remaining - ${creditCost}, 0)`,
        creditsUsed: sql`credits_used + ${creditCost}`,
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
        aiProvider: "runway",
        watermark: false,
        // Runway-only, no-fallback flag consumed by videoApis.ts (same
        // mechanism as the admin Generate page's temporary Runway preview).
        // lipSyncEnabled selects processRunwayLipSyncJob's render path.
        manifest: {
          reservedCredits: creditCost,
          preferDirectRunway: true,
          lipSyncEnabled,
        } as unknown as Record<string, unknown>,
        progressPercent: 0,
      })
      .returning();
    return inserted;
  });

  req.log.info(
    { userId, jobId, lipSyncEnabled, durationSeconds, creditCost },
    "Admin Runway Lip Sync job queued",
  );
  logger.info({ jobId, lipSyncEnabled }, "Runway Lip Sync Generator job created");

  res.status(201).json(job);
});

export default router;
