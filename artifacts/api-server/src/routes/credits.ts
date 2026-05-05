import { Router } from "express";
import { db } from "@workspace/db";
import { creditsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
      creditsUsed: newCredits.creditsUsed,
      totalGenerations: newCredits.totalGenerations,
    });
    return;
  }

  res.json({
    creditsRemaining: credits[0].creditsRemaining,
    creditsUsed: credits[0].creditsUsed,
    totalGenerations: credits[0].totalGenerations,
  });
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

  const existing = await db.select().from(creditsTable).where(eq(creditsTable.userId, targetUserId)).limit(1);
  if (existing[0]) {
    await db.update(creditsTable).set({ creditsRemaining: amount, updatedAt: new Date() }).where(eq(creditsTable.userId, targetUserId));
  } else {
    await db.insert(creditsTable).values({ id: randomUUID(), userId: targetUserId, creditsRemaining: amount });
  }

  res.json({ ok: true, userId: targetUserId, creditsRemaining: amount });
});

export default router;
