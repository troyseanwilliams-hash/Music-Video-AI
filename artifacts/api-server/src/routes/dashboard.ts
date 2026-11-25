import { Router } from "express";
import { db, lockActiveCredits } from "@workspace/db";
import { jobsTable, videosTable, creditsTable, usersTable } from "@workspace/db";
import { eq, count, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { touchPresence } from "../lib/presence.js";
import { welcomeCreditExpiry } from "../lib/welcomeOffer.js";
import { hasPurchasedTopupCredits } from "../lib/paidCreditEntitlement.js";

const router = Router();

router.get("/dashboard/stats", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;
  // Heartbeat: the navbar polls this every 15s for every logged-in user, so it
  // doubles as a presence signal for the admin "live now" view.
  touchPresence(
    userId,
    req.user.email ?? null,
    [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || null,
  );

  const [allJobs, totalVideosResult, credits, liveVideoRows, owners] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.userId, userId)),
    db
      .select({ count: count() })
      .from(videosTable)
      .where(and(eq(videosTable.userId, userId), isNull(videosTable.deletedAt))),
    db.transaction(async (tx) => {
      const row = await lockActiveCredits(tx, userId);
      return row ? [row] : [];
    }),
    // jobIds that still have a live (existing, non-deleted) video.
    db
      .select({ jobId: videosTable.jobId })
      .from(videosTable)
      .where(and(eq(videosTable.userId, userId), isNull(videosTable.deletedAt))),
    db.select({ createdAt: usersTable.createdAt, trialEndsAt: usersTable.trialEndsAt })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1),
  ]);

  // Recent Activity shows ONLY active saved videos: completed jobs whose video
  // still exists and hasn't been deleted. Everything else is excluded —
  // failed/in-progress jobs (no saved video), and videos deleted earlier whether
  // soft-deleted now or hard-deleted under older behavior (the row is gone).
  const liveJobIds = new Set(
    liveVideoRows.map((r) => r.jobId).filter((x): x is string => !!x),
  );
  const recentJobs = [...allJobs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .filter((j) => j.status === "ready" && !!j.videoId && liveJobIds.has(j.id))
    .slice(0, 5);

  // Jobs still being processed, so the user can jump back to their status page.
  const IN_PROGRESS = ["pending_approval", "queued", "analyzing", "generating", "stitching"];
  const activeJobs = [...allJobs]
    .filter((j) => IN_PROGRESS.includes(j.status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map((j) => ({
      id: j.id,
      prompt: j.prompt,
      status: j.status,
      progressPercent: j.progressPercent,
      jobType: j.jobType,
      createdAt: j.createdAt,
    }));
  const activePreviewJobs = allJobs.filter(
    (j) => j.jobType === "preview_backfill" && IN_PROGRESS.includes(j.status),
  ).length;

  let creditsRemaining = 10;
  let subscriptionCredits = 10;
  let welcomeCredits = 0;
  let topupCredits = 0;
  if (credits[0]) {
    creditsRemaining = credits[0].creditsRemaining;
    subscriptionCredits = credits[0].subscriptionCredits;
    welcomeCredits = credits[0].welcomeCredits;
    topupCredits = credits[0].topupCredits;
  } else {
    try {
      await db
        .insert(creditsTable)
        .values({ id: randomUUID(), userId })
        .onConflictDoNothing();
    } catch {
      // FK violation: stale session referencing a deleted user — ignore
    }
  }

  const hasPurchasedCredits = topupCredits > 0 && (await hasPurchasedTopupCredits(db, userId));

  const completedJobs = allJobs.filter((j) => j.status === "ready").length;
  const processingJobs = allJobs.filter(
    (j) =>
      j.status === "queued" ||
      j.status === "analyzing" ||
      j.status === "generating" ||
      j.status === "stitching",
  ).length;
  const failedJobs = allJobs.filter((j) => j.status === "failed").length;

  res.json({
    totalJobs: allJobs.length,
    completedJobs,
    processingJobs,
    failedJobs,
    totalVideos: totalVideosResult[0]?.count ?? 0,
    creditsRemaining,
    subscriptionCredits,
    welcomeCredits,
    welcomeExpiresAt: owners[0] ? welcomeCreditExpiry(owners[0]) : null,
    topupCredits,
    hasPurchasedCredits,
    recentJobs,
    activeJobs,
    activePreviewJobs,
  });
});

export default router;
