import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import {
  ListVideosQueryParams,
  GetVideoParams,
  DeleteVideoParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/videos", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parseResult = ListVideosQueryParams.safeParse(req.query);
  const page = parseResult.success ? (parseResult.data.page ?? 1) : 1;
  const limit = parseResult.success ? (parseResult.data.limit ?? 20) : 20;
  const offset = (page - 1) * limit;

  const [videos, totalResult] = await Promise.all([
    db
      .select()
      .from(videosTable)
      .where(eq(videosTable.userId, req.user.id))
      .orderBy(desc(videosTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(videosTable)
      .where(eq(videosTable.userId, req.user.id)),
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

  await db.delete(videosTable).where(eq(videosTable.id, parseResult.data.id));

  res.json({ success: true });
});

export default router;
