import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, videosTable, creditsTable } from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

router.get("/dashboard/stats", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  const [allJobs, totalVideosResult, credits, recentJobs] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.userId, userId)),
    db
      .select({ count: count() })
      .from(videosTable)
      .where(eq(videosTable.userId, userId)),
    db
      .select()
      .from(creditsTable)
      .where(eq(creditsTable.userId, userId))
      .limit(1),
    db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.userId, userId))
      .orderBy(desc(jobsTable.createdAt))
      .limit(5),
  ]);

  let creditsRemaining = 10;
  if (credits[0]) {
    creditsRemaining = credits[0].creditsRemaining;
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
    recentJobs,
  });
});

export default router;
