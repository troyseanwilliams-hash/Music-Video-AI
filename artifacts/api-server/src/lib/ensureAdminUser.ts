import bcrypt from "bcrypt";
import crypto from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export async function ensureAdminUser(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) return;

  const [existing] = await db
    .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  const hash = await bcrypt.hash(password, 12);

  if (!existing) {
    const nameParts = (process.env.ADMIN_NAME ?? "Admin").trim().split(/\s+/);
    await db.insert(usersTable).values({
      id: crypto.randomUUID(),
      email,
      passwordHash: hash,
      firstName: nameParts[0] ?? "Admin",
      lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
      subscriptionStatus: "trial",
      trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      lastLoginAt: new Date(),
    });
    logger.info({ email }, "Admin user created on startup");
  } else {
    await db
      .update(usersTable)
      .set({ passwordHash: hash })
      .where(eq(usersTable.email, email));
    logger.info({ email }, "Admin user password synced on startup");
  }
}
