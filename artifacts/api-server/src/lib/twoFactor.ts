import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db, authRateLimitsTable, twoFactorTable } from "@workspace/db";
import { eq, lt, sql } from "drizzle-orm";
import { decryptSeed, recoveryIndex, validStep } from "./twoFactorCrypto.js";

export type AuthTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function authOriginGuard(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  const origin = req.get("origin");
  if (origin) {
    const allowed = [req.get("host"), process.env.REPLIT_DEV_DOMAIN, ...(process.env.REPLIT_DOMAINS ?? "").split(",")];
    try {
      if (process.env.APP_URL) allowed.push(new URL(process.env.APP_URL).host);
      const url = new URL(origin);
      if (!["https:", "http:"].includes(url.protocol) || !allowed.includes(url.host)) throw new Error("origin");
    } catch {
      res.status(403).json({ error: "Please use this website directly to manage sign-in." });
      return;
    }
  }
  next();
}

export async function allowAuthAttempt(identifier: string, limit: number): Promise<boolean> {
  const key = createHash("sha256").update(identifier).digest("hex");
  const now = new Date();
  const resetAt = new Date(now.getTime() + 15 * 60_000);
  const [row] = await db.insert(authRateLimitsTable).values({ key, attempts: 1, resetAt })
    .onConflictDoUpdate({
      target: authRateLimitsTable.key,
      set: {
        attempts: sql`CASE WHEN ${authRateLimitsTable.resetAt} <= ${now} THEN 1 ELSE ${authRateLimitsTable.attempts} + 1 END`,
        resetAt: sql`CASE WHEN ${authRateLimitsTable.resetAt} <= ${now} THEN ${resetAt} ELSE ${authRateLimitsTable.resetAt} END`,
      },
    }).returning();
  // Limit retention of hashed rate-limit keys without a separate scheduler.
  await db.delete(authRateLimitsTable).where(lt(authRateLimitsTable.resetAt, new Date(now.getTime() - 86_400_000)));
  return row.attempts <= limit;
}

// Caller MUST hold the users row lock. That lock serializes enable/disable,
// login, recovery-code consumption, and replay prevention across replicas.
export async function verifySecondFactor(tx: AuthTransaction, userId: string, code: string): Promise<boolean> {
  const [record] = await tx.select().from(twoFactorTable).where(eq(twoFactorTable.userId, userId));
  if (!record?.enabled) return false;
  const index = recoveryIndex(record.recoveryHashes, code);
  if (index >= 0) {
    await tx.update(twoFactorTable).set({ recoveryHashes: record.recoveryHashes.filter((_, i) => i !== index) }).where(eq(twoFactorTable.userId, userId));
    return true;
  }
  const step = validStep(decryptSeed(record.encryptedSecret, userId), code.trim(), record.lastUsedStep);
  if (step === null) return false;
  await tx.update(twoFactorTable).set({ lastUsedStep: step }).where(eq(twoFactorTable.userId, userId));
  return true;
}
