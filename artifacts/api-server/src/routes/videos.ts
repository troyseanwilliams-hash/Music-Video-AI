import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable, videoLikesTable, usersTable } from "@workspace/db";
import { eq, and, desc, count, sql, inArray, isNull } from "drizzle-orm";
import {
  ListVideosQueryParams,
  GetVideoParams,
  DeleteVideoParams,
} from "@workspace/api-zod";

const router = Router();

function isAdminEmail(email?: string | null): boolean {
  return !!(
    process.env.ADMIN_EMAIL &&
    email &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
}

router.get("/videos", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parseResult = ListVideosQueryParams.safeParse(req.query);
  const page = parseResult.success ? (parseResult.data.page ?? 1) : 1;
  const limit = parseResult.success ? (parseResult.data.limit ?? 20) : 20;
  const offset = (page - 1) * limit;

  // Exclude soft-deleted videos from the user's library.
  const notDeleted = and(eq(videosTable.userId, req.user.id), isNull(videosTable.deletedAt));
  const [videos, totalResult] = await Promise.all([
    db
      .select()
      .from(videosTable)
      .where(notDeleted)
      .orderBy(desc(videosTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(videosTable)
      .where(notDeleted),
  ]);

  res.json({
    videos,
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  });
});

router.get("/videos/:id", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parseResult = GetVideoParams.safeParse(req.params);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid video id" });
    return;
  }

  const video = await db
    .select()
    .from(videosTable)
    .where(
      and(
        eq(videosTable.id, parseResult.data.id),
        eq(videosTable.userId, req.user.id),
        isNull(videosTable.deletedAt),
      ),
    )
    .limit(1);

  if (!video[0]) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  res.json(video[0]);
});

router.delete("/videos/:id", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parseResult = DeleteVideoParams.safeParse(req.params);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid video id" });
    return;
  }

  const video = await db
    .select()
    .from(videosTable)
    .where(
      and(
        eq(videosTable.id, parseResult.data.id),
        eq(videosTable.userId, req.user.id),
      ),
    )
    .limit(1);

  if (!video[0]) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // Soft delete: mark as deleted rather than removing the row. It disappears
  // from every user-facing view immediately, but admins can still see it and
  // the files stay in storage until permanently purged (manual or auto-purge).
  await db
    .update(videosTable)
    .set({ deletedAt: new Date(), isPublic: false })
    .where(eq(videosTable.id, parseResult.data.id));

  res.json({ success: true });
});

// ── Public gallery: list all public videos (no auth). Sorted by likes, recency.
router.get("/gallery", async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(String(req.query.limit ?? "24"), 10) || 24));
  const offset = (page - 1) * limit;

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: videosTable.id,
        videoObjectPath: videosTable.videoObjectPath,
        thumbnailObjectPath: videosTable.thumbnailObjectPath,
        title: videosTable.title,
        durationSeconds: videosTable.durationSeconds,
        style: videosTable.style,
        likeCount: videosTable.likeCount,
        createdAt: videosTable.createdAt,
        creatorName: usersTable.firstName,
      })
      .from(videosTable)
      .leftJoin(usersTable, eq(usersTable.id, videosTable.userId))
      .where(and(eq(videosTable.isPublic, true), isNull(videosTable.deletedAt)))
      .orderBy(desc(videosTable.likeCount), desc(videosTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(videosTable)
      .where(and(eq(videosTable.isPublic, true), isNull(videosTable.deletedAt))),
  ]);

  // Mark which of these the requester has already liked (if logged in).
  let likedSet = new Set<string>();
  if (req.isAuthenticated() && rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const likes = await db
      .select({ videoId: videoLikesTable.videoId })
      .from(videoLikesTable)
      .where(and(eq(videoLikesTable.userId, req.user.id), inArray(videoLikesTable.videoId, ids)));
    likedSet = new Set(likes.map((l) => l.videoId));
  }

  res.json({
    videos: rows.map((r) => ({ ...r, liked: likedSet.has(r.id) })),
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  });
});

// ── Toggle a video's public visibility (owner or admin only).
router.patch("/videos/:id/visibility", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = String(req.params.id || "");
  const isPublic = (req.body as { isPublic?: unknown })?.isPublic;
  if (typeof isPublic !== "boolean") {
    res.status(400).json({ error: "isPublic (boolean) is required" });
    return;
  }

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, id)).limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  if (video.userId !== req.user.id) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
    if (!isAdminEmail(u?.email)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  await db.update(videosTable).set({ isPublic }).where(eq(videosTable.id, id));
  res.json({ id, isPublic });
});

// ── Rename a video (owner or admin). Powers inline rename in the gallery
// and dashboard.
router.patch("/videos/:id/title", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = String(req.params.id || "");
  const rawTitle = (req.body as { title?: unknown })?.title;
  if (typeof rawTitle !== "string") {
    res.status(400).json({ error: "title (string) is required" });
    return;
  }
  const title = rawTitle.trim().slice(0, 120);
  if (!title) {
    res.status(400).json({ error: "Title can't be empty." });
    return;
  }

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, id)).limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  if (video.userId !== req.user.id) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
    if (!isAdminEmail(u?.email)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  await db.update(videosTable).set({ title }).where(eq(videosTable.id, id));
  res.json({ id, title });
});

// ── Like a public video (idempotent; never double-counts).
router.post("/videos/:id/like", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = String(req.params.id || "");
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, id)).limit(1);
  if (!video || !video.isPublic) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const likeCount = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(videoLikesTable)
      .values({ userId: req.user.id, videoId: id })
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) {
      await tx
        .update(videosTable)
        .set({ likeCount: sql`${videosTable.likeCount} + 1` })
        .where(eq(videosTable.id, id));
    }
    const [v] = await tx
      .select({ likeCount: videosTable.likeCount })
      .from(videosTable)
      .where(eq(videosTable.id, id))
      .limit(1);
    return v?.likeCount ?? 0;
  });

  res.json({ liked: true, likeCount });
});

// ── Unlike a video (idempotent).
router.delete("/videos/:id/like", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = String(req.params.id || "");

  const likeCount = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(videoLikesTable)
      .where(and(eq(videoLikesTable.userId, req.user.id), eq(videoLikesTable.videoId, id)))
      .returning();
    if (deleted.length > 0) {
      await tx
        .update(videosTable)
        .set({ likeCount: sql`GREATEST(${videosTable.likeCount} - 1, 0)` })
        .where(eq(videosTable.id, id));
    }
    const [v] = await tx
      .select({ likeCount: videosTable.likeCount })
      .from(videosTable)
      .where(eq(videosTable.id, id))
      .limit(1);
    return v?.likeCount ?? 0;
  });

  res.json({ liked: false, likeCount });
});

export default router;
