import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, videosTable, creditsTable } from "@workspace/db";
import { eq, count, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

router.get("/dashboard/stats", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  const [allJobs, totalVideosResult, credits, liveVideoRows] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.userId, userId)),
    db
      .select({ count: count() })
      .from(videosTable)
      .where(and(eq(videosTable.userId, userId), isNull(videosTable.deletedAt))),
    db
      .select()
      .from(creditsTable)
      .where(eq(creditsTable.userId, userId))
      .limit(1),
    // jobIds that still have a live (existing, non-deleted) video.
    db
      .select({ jobId: videosTable.jobId })
      .from(videosTable)
      .where(and(eq(videosTable.userId, userId), isNull(videosTable.deletedAt))),
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

  let creditsRemaining = 10;
  let subscriptionCredits = 10;
  let topupCredits = 0;
  if (credits[0]) {
    creditsRemaining = credits[0].creditsRemaining;
    subscriptionCredits = credits[0].subscriptionCredits;
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
    topupCredits,
    recentJobs,
  });
});

export default router;
