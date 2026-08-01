import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, usersTable } from "@workspace/db";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { downloadClip } from "../lib/videoApis.js";

function isAdmin(email: string | null | undefined): boolean {
  return !!(
    process.env.ADMIN_EMAIL &&
    email &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
}

const router = Router();

// Jobs currently in-flight (queued / analyzing / generating / stitching).
// Used by the admin to spot stuck jobs and force-fail them.
router.get("/admin/jobs/active", async (req, res) => {
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
      jobType: jobsTable.jobType,
      prompt: jobsTable.prompt,
      style: jobsTable.style,
      errorMessage: jobsTable.errorMessage,
      retryCount: jobsTable.retryCount,
      claimedAt: jobsTable.claimedAt,
      createdAt: jobsTable.createdAt,
      updatedAt: jobsTable.updatedAt,
    })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.userId, usersTable.id))
    .where(inArray(jobsTable.status, ["queued", "analyzing", "generating", "stitching"]))
    .orderBy(desc(jobsTable.updatedAt))
    .limit(50);

  res.json({ jobs });
});

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

// Force-fail any in-progress job (stitching / generating / etc.) without
// waiting for the auto-recovery timeout. Admin only.
router.post("/admin/jobs/:id/force-fail", async (req, res) => {
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

  if (job.status === "ready" || job.status === "failed") {
    res.status(400).json({ error: `Job is already ${job.status}` });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({
      status: "failed",
      errorMessage: "Manually force-failed by admin",
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, id))
    .returning();

  req.log.info({ jobId: id, previousStatus: job.status }, "Admin force-failed job");
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

// Email delivery smoke test. Sends a test email to the admin, plus optionally
// to any address passed as { to } — use this to verify the Resend API key and
// domain before relying on reset/render emails.
// POST /api/admin/test-email  { to?: string }
router.post("/admin/test-email", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    res.status(500).json({ ok: false, error: "RESEND_API_KEY is not set" });
    return;
  }

  const targets = [process.env.ADMIN_EMAIL!];
  const extra = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  if (extra && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(extra)) targets.push(extra);

  const results: { to: string; ok: boolean; error?: string }[] = [];
  for (const to of targets) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "AI Beat Sync <notifications@aibeatsync.com>",
          to,
          subject: "AI Beat Sync — email delivery test",
          html: `<div style="font-family:sans-serif;padding:24px"><h2>Email works ✔</h2><p>This is a delivery test sent from the admin panel at ${new Date().toISOString()}.</p></div>`,
        }),
      });
      const body = await r.text();
      results.push(r.ok ? { to, ok: true } : { to, ok: false, error: `Resend ${r.status}: ${body.slice(0, 200)}` });
    } catch (err) {
      results.push({ to, ok: false, error: String(err) });
    }
  }

  req.log.info({ results }, "Admin email test");
  res.json({ ok: results.every((r) => r.ok), results });
});

// Manually attach provider-rendered clips to a job by URL. Used to rescue
// clips that finished on the provider (visible in its dashboard) but were
// never downloaded because polling stopped — the job's next run reuses them
// via manifest.partialClips instead of paying to regenerate.
// Body: { clips: [{ index: number, url: string }] }
router.post("/admin/jobs/:id/attach-clips", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const jobId = req.params.id;
  const clipsInput = Array.isArray(req.body?.clips) ? req.body.clips : null;
  if (!clipsInput || clipsInput.length === 0) {
    res.status(400).json({ error: "Body must be { clips: [{ index, url }] }" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const storage = new ObjectStorageService();
  const results: { index: number; ok: boolean; error?: string }[] = [];
  const attached: Record<string, string> = {};

  for (const c of clipsInput) {
    const index = Number(c?.index);
    const url = typeof c?.url === "string" ? c.url.trim() : "";
    if (!Number.isInteger(index) || index < 0 || !/^https:\/\//.test(url)) {
      results.push({ index: Number.isFinite(index) ? index : -1, ok: false, error: "index must be a non-negative integer and url must be https" });
      continue;
    }
    try {
      const buf = await downloadClip(url);
      if (buf.length < 10_000) throw new Error(`Downloaded file is suspiciously small (${buf.length} bytes) — is the link a video?`);
      const path = await storage.uploadClipBuffer(buf, `job-${jobId}`, index);
      attached[index] = path;
      results.push({ index, ok: true });
    } catch (err) {
      results.push({ index, ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 300) });
    }
  }

  if (Object.keys(attached).length > 0) {
    // Merge into manifest.partialClips atomically (jsonb concat) so we don't
    // clobber clips the job processor saved while we were downloading.
    await db.execute(sql`
      UPDATE jobs
      SET manifest = jsonb_set(
            COALESCE(manifest, '{}'::jsonb),
            '{partialClips}',
            COALESCE(manifest->'partialClips', '{}'::jsonb) || ${JSON.stringify(attached)}::jsonb
          ),
          updated_at = NOW()
      WHERE id = ${jobId}
    `);
  }

  req.log.info({ jobId, results }, "Admin attached clips to job");
  res.json({ ok: results.every((r) => r.ok), attached: Object.keys(attached).length, results });
});

export default router;
