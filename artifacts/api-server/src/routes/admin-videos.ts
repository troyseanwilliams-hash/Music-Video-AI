import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable, usersTable } from "@workspace/db";
import { eq, desc, isNotNull } from "drizzle-orm";
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

// ── Permanently delete a video: remove its stored files (MP4, thumbnail, clips)
// AND its database row. Irreversible. Admin only.
router.post("/admin/videos/:id/purge", async (req, res) => {
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

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // Delete the underlying storage assets first (best-effort), then the row so a
  // storage hiccup never leaves an orphaned DB record pointing at gone files.
  const storageService = new ObjectStorageService();
  await storageService.deleteVideoAssets(video).catch(() => {});
  await db.delete(videosTable).where(eq(videosTable.id, id));

  res.json({ success: true, id });
});

export default router;
