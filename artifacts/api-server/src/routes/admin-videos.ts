import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { jobsTable, videosTable, usersTable } from "@workspace/db";
import { and, eq, desc, inArray, isNotNull, isNull } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage.js";

function isAdmin(email: string | null | undefined): boolean {
  return !!(
    process.env.ADMIN_EMAIL &&
    email &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
}

const router = Router();

// ── List every soft-deleted video across all users (admin only). These are the
// files a user has deleted but that are still on the site (not yet purged).
router.get("/admin/deleted-videos", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await db
    .select({
      id: videosTable.id,
      userId: videosTable.userId,
      email: usersTable.email,
      title: videosTable.title,
      durationSeconds: videosTable.durationSeconds,
      style: videosTable.style,
      videoObjectPath: videosTable.videoObjectPath,
      thumbnailObjectPath: videosTable.thumbnailObjectPath,
      isPublic: videosTable.isPublic,
      createdAt: videosTable.createdAt,
      deletedAt: videosTable.deletedAt,
    })
    .from(videosTable)
    .leftJoin(usersTable, eq(usersTable.id, videosTable.userId))
    .where(isNotNull(videosTable.deletedAt))
    .orderBy(desc(videosTable.deletedAt))
    .limit(500);

  res.json({ videos: rows });
});

// ── Signed URL to preview a (usually deleted) video in the admin panel. Works
// for any user's video, unlike the owner-scoped /jobs/:id/video-url. Admin only.
router.get("/admin/videos/:id/preview-url", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const id = String(req.params.id || "");
  const [video] = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.id, id))
    .limit(1);

  if (!video || !video.videoObjectPath) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  try {
    const storageService = new ObjectStorageService();
    const url = await storageService.getObjectEntitySignedUrl(
      video.previewObjectPath || video.videoObjectPath,
      3600,
    );
    res.json({ url });
  } catch {
    // The DB row exists but the underlying file is already gone from storage.
    res.status(410).json({ error: "Video file is no longer available." });
  }
});

router.post("/admin/videos/:id/preview-backfill", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const storageService = new ObjectStorageService();
  const result = await db.transaction(async (tx) => {
    const [video] = await tx
      .select()
      .from(videosTable)
      .where(eq(videosTable.id, String(req.params.id || "")))
      .limit(1)
      .for("update");
    if (!video) return { status: 404 as const, body: { error: "Video not found" } };
    if (video.previewObjectPath) {
      return { status: 200 as const, body: { state: "ready", previewObjectPath: video.previewObjectPath } };
    }
    const expectedPreviewPath = `/objects/video-previews/${video.id}.mp4`;
    if (await storageService.objectExists(expectedPreviewPath)) {
      await tx
        .update(videosTable)
        .set({ previewObjectPath: expectedPreviewPath })
        .where(eq(videosTable.id, video.id));
      return {
        status: 200 as const,
        body: { state: "ready", previewObjectPath: expectedPreviewPath },
      };
    }
    const [existing] = await tx
      .select({ id: jobsTable.id, status: jobsTable.status })
      .from(jobsTable)
      .where(and(
        eq(jobsTable.jobType, "preview_backfill"),
        eq(jobsTable.videoId, video.id),
        inArray(jobsTable.status, ["queued", "analyzing", "generating", "stitching"]),
      ))
      .limit(1);
    if (existing) {
      return { status: 202 as const, body: { state: "queued", jobId: existing.id } };
    }
    const jobId = randomUUID();
    await tx.insert(jobsTable).values({
      id: jobId,
      userId: video.userId,
      jobType: "preview_backfill",
      videoId: video.id,
      manifest: { operation: "preview_backfill", targetVideoId: video.id },
      status: "queued",
      progressPercent: 0,
    });
    return { status: 202 as const, body: { state: "queued", jobId } };
  });
  res.status(result.status).json(result.body);
});

router.post("/admin/videos/preview-backfill-all", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const candidates = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(and(
      isNull(videosTable.previewObjectPath),
      isNull(videosTable.deletedAt),
    ))
    .orderBy(desc(videosTable.createdAt))
    .limit(100);

  let queued = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const created = await db.transaction(async (tx) => {
      const [video] = await tx
        .select({ id: videosTable.id, userId: videosTable.userId })
        .from(videosTable)
        .where(and(
          eq(videosTable.id, candidate.id),
          isNull(videosTable.previewObjectPath),
          isNull(videosTable.deletedAt),
        ))
        .limit(1)
        .for("update");
      if (!video) return false;

      const [existing] = await tx
        .select({ id: jobsTable.id })
        .from(jobsTable)
        .where(and(
          eq(jobsTable.jobType, "preview_backfill"),
          eq(jobsTable.videoId, video.id),
          inArray(jobsTable.status, ["queued", "analyzing", "generating", "stitching"]),
        ))
        .limit(1);
      if (existing) return false;

      await tx.insert(jobsTable).values({
        id: randomUUID(),
        userId: video.userId,
        jobType: "preview_backfill",
        videoId: video.id,
        manifest: { operation: "preview_backfill", targetVideoId: video.id },
        status: "queued",
        progressPercent: 0,
      });
      return true;
    });
    if (created) queued++;
    else skipped++;
  }

  res.status(202).json({ queued, skipped, scanned: candidates.length });
});

// ── Permanently delete a video: remove its stored files (MP4, thumbnail, clips)
// AND its database row. Irreversible. Admin only.
router.post("/admin/videos/:id/purge", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const id = String(req.params.id || "");
  const storageService = new ObjectStorageService();
  const purged = await db.transaction(async (tx) => {
    const [video] = await tx
      .select()
      .from(videosTable)
      .where(eq(videosTable.id, id))
      .limit(1)
      .for("update");
    if (!video) return false;

    // Hold the video-row lock while reading and deleting the complete asset
    // list. Preview finalization uses the same lock, so neither ordering can
    // leave a newly attached browser rendition orphaned.
    await storageService.deleteVideoAssets(video).catch(() => {});
    await tx.delete(videosTable).where(eq(videosTable.id, id));
    return true;
  });

  if (!purged) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  res.json({ success: true, id });
});

export default router;
