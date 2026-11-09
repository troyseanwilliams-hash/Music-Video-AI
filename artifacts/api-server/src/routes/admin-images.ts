import { Router } from "express";
import { and, count, desc, eq, ilike, or, isNull } from "drizzle-orm";
import { db, imageAssetsTable, usersTable } from "@workspace/db";
import { z } from "zod";

const router = Router();

function isAdmin(email: string | null | undefined): boolean {
  return Boolean(
    process.env.ADMIN_EMAIL
      && email
      && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase(),
  );
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  search: z.string().trim().max(160).optional(),
});

router.get("/admin/images", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!isAdmin(req.user.email)) {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid image review query" });
    return;
  }

  const { page, limit, search } = parsed.data;
  const searchPattern = search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : null;
  const where = and(
    isNull(imageAssetsTable.deletedAt),
    searchPattern
      ? or(
          ilike(imageAssetsTable.prompt, searchPattern),
          ilike(usersTable.email, searchPattern),
        )
      : undefined,
  );
  const [assets, totalResult] = await Promise.all([
    db.select({
      id: imageAssetsTable.id,
      userId: imageAssetsTable.userId,
      email: usersTable.email,
      jobId: imageAssetsTable.jobId,
      assetIndex: imageAssetsTable.assetIndex,
      objectPath: imageAssetsTable.objectPath,
      prompt: imageAssetsTable.prompt,
      isPublic: imageAssetsTable.isPublic,
      style: imageAssetsTable.style,
      createdAt: imageAssetsTable.createdAt,
    })
      .from(imageAssetsTable)
      .leftJoin(usersTable, eq(usersTable.id, imageAssetsTable.userId))
      .where(where)
      .orderBy(desc(imageAssetsTable.createdAt), desc(imageAssetsTable.assetIndex))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ count: count() })
      .from(imageAssetsTable)
      .leftJoin(usersTable, eq(usersTable.id, imageAssetsTable.userId))
      .where(where),
  ]);

  res.setHeader("Cache-Control", "private, no-store");
  res.json({ assets, total: totalResult[0]?.count ?? 0, page, limit });
});

export default router;
