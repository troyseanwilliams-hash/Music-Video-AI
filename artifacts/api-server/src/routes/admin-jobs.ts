import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

function isAdmin(email: string | null | undefined): boolean {
  return !!(
    process.env.ADMIN_EMAIL &&
    email &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
}

const router = Router();

router.get("/admin/jobs/pending", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const jobs = await db
    .select({
      id: jobsTable.id,
      userId: jobsTable.userId,
      email: usersTable.email,
      status: jobsTable.status,
      prompt: jobsTable.prompt,
      style: jobsTable.style,
      requestedDuration: jobsTable.requestedDuration,
      audioSourceType: jobsTable.audioSourceType,
      createdAt: jobsTable.createdAt,
    })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.userId, usersTable.id))
    .where(eq(jobsTable.status, "pending_approval"))
    .orderBy(desc(jobsTable.createdAt))
    .limit(50);

  res.json({ jobs });
});

router.post("/admin/jobs/:id/approve", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { id } = req.params;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "pending_approval") {
    res.status(400).json({ error: "Job is not pending approval" });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({ status: "queued", updatedAt: new Date() })
    .where(eq(jobsTable.id, id))
    .returning();

  req.log.info({ jobId: id }, "Admin approved job — moving to queued");
  res.json(updated);
});

router.get("/admin/jobs/failed", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const jobs = await db
    .select({
      id: jobsTable.id,
      userId: jobsTable.userId,
      email: usersTable.email,
      status: jobsTable.status,
      prompt: jobsTable.prompt,
      style: jobsTable.style,
      requestedDuration: jobsTable.requestedDuration,
      audioSourceType: jobsTable.audioSourceType,
      errorMessage: jobsTable.errorMessage,
      retryCount: jobsTable.retryCount,
      createdAt: jobsTable.createdAt,
      updatedAt: jobsTable.updatedAt,
    })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.userId, usersTable.id))
    .where(eq(jobsTable.status, "failed"))
    .orderBy(desc(jobsTable.updatedAt))
    .limit(50);

  res.json({ jobs });
});

router.post("/admin/jobs/:id/retry", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { id } = req.params;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "failed") {
    res.status(400).json({ error: "Only failed jobs can be retried" });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({
      status: "queued",
      errorMessage: null,
      retryCount: 0,
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, id))
    .returning();

  req.log.info({ jobId: id }, "Admin retried failed job — moving to queued");
  res.json(updated);
});

router.post("/admin/jobs/:id/reject", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { id } = req.params;
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "pending_approval") {
    res.status(400).json({ error: "Job is not pending approval" });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({
      status: "failed",
      errorMessage: "Rejected by admin",
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, id))
    .returning();

  req.log.info({ jobId: id }, "Admin rejected job");
  res.json(updated);
});

export default router;
