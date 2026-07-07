import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, videosTable, creditsTable } from "@workspace/db";
import { eq, count, desc, and, isNull, isNotNull, notInArray } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

router.get("/dashboard/stats", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  // Jobs whose resulting video the user has soft-deleted — hidden from the
  // dashboard's recent-generations list so deleted videos don't linger there.
  const deletedVideoRows = await db
    .select({ jobId: videosTable.jobId })
    .from(videosTable)
    .where(and(eq(videosTable.userId, userId), isNotNull(videosTable.deletedAt)));
  const deletedJobIds = deletedVideoRows
    .map((r) => r.jobId)
    .filter((x): x is string => !!x);

  const recentJobsWhere =
    deletedJobIds.length > 0
      ? and(eq(jobsTable.userId, userId), notInArray(jobsTable.id, deletedJobIds))
      : eq(jobsTable.userId, userId);

  const [allJobs, totalVideosResult, credits, recentJobs] = await Promise.all([
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
    db
      .select()
      .from(jobsTable)
      .where(recentJobsWhere)
      .orderBy(desc(jobsTable.createdAt))
      .limit(5),
  ]);

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
