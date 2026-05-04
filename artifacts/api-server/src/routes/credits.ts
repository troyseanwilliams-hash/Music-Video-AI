import { Router } from "express";
import { db } from "@workspace/db";
import { creditsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

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

export default router;
