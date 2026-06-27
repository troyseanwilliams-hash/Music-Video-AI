import { Router } from "express";
import { db } from "@workspace/db";
import { creditsTable, usersTable, videosTable } from "@workspace/db";
import { eq, ilike, or, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

function isAdmin(email: string | null | undefined): boolean {
  return !!(process.env.ADMIN_EMAIL && email && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
}

const router = Router();

router.get("/credits", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const credits = await db
    .select()
    .from(creditsTable)
    .where(eq(creditsTable.userId, req.user.id))
    .limit(1);

  if (!credits[0]) {
    const [newCredits] = await db
      .insert(creditsTable)
      .values({ id: randomUUID(), userId: req.user.id })
      .returning();
    res.json({
      creditsRemaining: newCredits.creditsRemaining,
      subscriptionCredits: newCredits.subscriptionCredits,
      topupCredits: newCredits.topupCredits,
      creditsUsed: newCredits.creditsUsed,
      totalGenerations: newCredits.totalGenerations,
    });
    return;
  }

  res.json({
    creditsRemaining: credits[0].creditsRemaining,
    subscriptionCredits: credits[0].subscriptionCredits,
    topupCredits: credits[0].topupCredits,
    creditsUsed: credits[0].creditsUsed,
    totalGenerations: credits[0].totalGenerations,
  });
});

router.get("/admin/users", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { search } = req.query as { search?: string };

  const allUsers = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      subscriptionStatus: usersTable.subscriptionStatus,
      isDisabled: usersTable.isDisabled,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(
      search
        ? or(
            ilike(usersTable.email, `%${search}%`),
            ilike(usersTable.firstName, `%${search}%`),
            ilike(usersTable.lastName, `%${search}%`),
          )
        : undefined,
    )
    .orderBy(desc(usersTable.createdAt))
    .limit(200);

  const userIds = allUsers.map((u) => u.id);
  const creditRows =
    userIds.length > 0
      ? await db
          .select()
          .from(creditsTable)
          .where(or(...userIds.map((id) => eq(creditsTable.userId, id))))
      : [];

  const creditMap = new Map(creditRows.map((c) => [c.userId, c]));

  const users = allUsers.map((u) => {
    const c = creditMap.get(u.id);
    return {
      ...u,
      creditsRemaining: c?.creditsRemaining ?? 0,
      subscriptionCredits: c?.subscriptionCredits ?? 0,
      topupCredits: c?.topupCredits ?? 0,
      creditsUsed: c?.creditsUsed ?? 0,
      totalGenerations: c?.totalGenerations ?? 0,
    };
  });

  res.json({ users });
});

router.post("/admin/credits/set", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { userId, email, amount } = req.body as { userId?: string; email?: string; amount: number };

  if (typeof amount !== "number" || amount < 0) {
    res.status(400).json({ error: "Invalid amount" });
    return;
  }

  let targetUserId = userId;
  if (!targetUserId && email) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    targetUserId = user.id;
  }

  if (!targetUserId) {
    res.status(400).json({ error: "userId or email required" });
    return;
  }

  // Admin overrides treat the new balance as a top-up so it survives any
  // future "reset monthly credits at renewal" behavior. The subscription
  // bucket is zeroed to make the totals add up.
  const existing = await db.select().from(creditsTable).where(eq(creditsTable.userId, targetUserId)).limit(1);
  if (existing[0]) {
    await db
      .update(creditsTable)
      .set({
        creditsRemaining: amount,
        subscriptionCredits: 0,
        topupCredits: amount,
        updatedAt: new Date(),
      })
      .where(eq(creditsTable.userId, targetUserId));
  } else {
    await db.insert(creditsTable).values({
      id: randomUUID(),
      userId: targetUserId,
      creditsRemaining: amount,
      subscriptionCredits: 0,
      topupCredits: amount,
    });
  }

  res.json({ ok: true, userId: targetUserId, creditsRemaining: amount });
});

// ── Admin: list a user's videos for moderation (playable via /api/storage path).
router.get("/admin/users/:id/videos", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const videos = await db
    .select({
      id: videosTable.id,
      videoObjectPath: videosTable.videoObjectPath,
      thumbnailObjectPath: videosTable.thumbnailObjectPath,
      title: videosTable.title,
      prompt: videosTable.prompt,
      isPublic: videosTable.isPublic,
      createdAt: videosTable.createdAt,
    })
    .from(videosTable)
    .where(eq(videosTable.userId, req.params.id))
    .orderBy(desc(videosTable.createdAt))
    .limit(100);
  res.json({ videos });
});

// ── Admin: block / unblock a user (sets isDisabled; login + middleware enforce it).
router.post("/admin/users/:id/disable", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const disabled = (req.body as { disabled?: unknown })?.disabled;
  if (typeof disabled !== "boolean") {
    res.status(400).json({ error: "disabled (boolean) is required" });
    return;
  }
  await db.update(usersTable).set({ isDisabled: disabled }).where(eq(usersTable.id, req.params.id));
  res.json({ id: req.params.id, isDisabled: disabled });
});

export default router;
