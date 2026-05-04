import { Router } from "express";
import bcrypt from "bcrypt";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.post("/admin-reset/set-password", async (req, res) => {
  const { secret, email, password } = req.body as { secret?: string; email?: string; password?: string };
  if (!secret || secret !== process.env.SESSION_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!email || !password) {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  const result = await db
    .update(usersTable)
    .set({ passwordHash: hash })
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .returning({ id: usersTable.id, email: usersTable.email });
  if (result.length === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ ok: true, updated: result[0] });
});

export default router;
