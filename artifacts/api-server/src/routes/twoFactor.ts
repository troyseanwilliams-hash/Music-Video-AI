import { Router } from "express";
import bcrypt from "bcrypt";
import QRCode from "qrcode";
import { db, usersTable, twoFactorTable, sessionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { GetTwoFactorResponse, UpdateTwoFactorBody, UpdateTwoFactorResponse } from "@workspace/api-zod";
import { getSessionId, type SessionData } from "../lib/auth.js";
import { allowAuthAttempt, authOriginGuard, verifySecondFactor } from "../lib/twoFactor.js";
import { decryptSeed, encryptSeed, newAuthenticator, newRecoveryCodes, validStep } from "../lib/twoFactorCrypto.js";

const router = Router();
router.use("/auth/two-factor", authOriginGuard);

router.get("/auth/two-factor", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Sign in first." }); return; }
  const [record] = await db.select().from(twoFactorTable).where(eq(twoFactorTable.userId, req.user.id));
  res.json(GetTwoFactorResponse.parse({ enabled: record?.enabled ?? false, recoveryCodesRemaining: record?.enabled ? record.recoveryHashes.length : 0 }));
});

router.post("/auth/two-factor", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Sign in first." }); return; }
  const userId = req.user.id;
  const parsed = UpdateTwoFactorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter your current password and verification code." }); return; }
  if (!(await allowAuthAttempt(`two-factor:${userId}`, 20))) {
    res.status(429).json({ error: "Too many attempts. Please wait 15 minutes before trying again." });
    return;
  }
  const { action, password, code = "" } = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    // Recheck the session after acquiring the same lock as sign-in, so a
    // concurrently revoked session cannot modify MFA settings.
    const sid = getSessionId(req);
    const [session] = sid ? await tx.select().from(sessionsTable).where(eq(sessionsTable.sid, sid)) : [];
    const data = session?.sess as SessionData | undefined;
    if (!user || user.isDisabled || !session || session.expire.getTime() <= Date.now() ||
        data?.user?.id !== userId || (data.authVersion ?? 0) !== user.authVersion) {
      return { status: 401, body: { error: "Your session expired. Sign in again." } };
    }
    if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return { status: 401, body: { error: "Incorrect password." } };
    }
    const [record] = await tx.select().from(twoFactorTable).where(eq(twoFactorTable.userId, userId));
    if (action === "setup") {
      if (record?.enabled) return { status: 409, body: { error: "Two-factor authentication is already enabled." } };
      const authenticator = newAuthenticator(user.email ?? user.id);
      const secret = authenticator.secret.base32;
      const expiresAt = new Date(Date.now() + 10 * 60_000);
      const values = { userId, encryptedSecret: encryptSeed(secret, userId), pendingExpiresAt: expiresAt, enabled: false, lastUsedStep: -1, recoveryHashes: [] };
      await tx.insert(twoFactorTable).values(values).onConflictDoUpdate({ target: twoFactorTable.userId, set: values });
      const qrCode = await QRCode.toDataURL(authenticator.toString(), { width: 240, margin: 2 });
      return { status: 200, body: { enabled: false, secret, qrCode, expiresAt: expiresAt.toISOString() } };
    }
    if (action === "enable") {
      if (!record || record.enabled || !record.pendingExpiresAt || record.pendingExpiresAt.getTime() <= Date.now()) {
        return { status: 400, body: { error: "Setup expired or changed. Start setup again." } };
      }
      const step = validStep(decryptSeed(record.encryptedSecret, userId), code.trim(), -1);
      if (step === null) return { status: 401, body: { error: "Invalid authenticator code. Check your phone's time and try again." } };
      const recovery = newRecoveryCodes();
      await tx.update(twoFactorTable).set({ enabled: true, pendingExpiresAt: null, lastUsedStep: step, recoveryHashes: recovery.hashes }).where(eq(twoFactorTable.userId, userId));
      await rotateSessions();
      return { status: 200, body: { enabled: true, recoveryCodes: recovery.codes } };
    }
    if (!record?.enabled) return { status: 409, body: { error: "Two-factor authentication is not enabled." } };
    if (!(await verifySecondFactor(tx, userId, code))) {
      return { status: 401, body: { error: "Invalid or already-used code. Use a new authenticator code or an unused recovery code." } };
    }
    if (action === "disable") {
      await tx.delete(twoFactorTable).where(eq(twoFactorTable.userId, userId));
      await rotateSessions();
      return { status: 200, body: { enabled: false } };
    }
    const recovery = newRecoveryCodes();
    await tx.update(twoFactorTable).set({ recoveryHashes: recovery.hashes }).where(eq(twoFactorTable.userId, userId));
    await rotateSessions();
    return { status: 200, body: { enabled: true, recoveryCodes: recovery.codes } };

    async function rotateSessions() {
      const version = user.authVersion + 1;
      await tx.update(usersTable).set({ authVersion: version }).where(eq(usersTable.id, userId));
      await tx.update(sessionsTable).set({
        sess: sql`jsonb_set(${sessionsTable.sess}, '{authVersion}', to_jsonb(${version}::integer))`,
      }).where(eq(sessionsTable.sid, sid!));
    }
  });
  res.status(result.status).json(result.status === 200 ? UpdateTwoFactorResponse.parse(result.body) : result.body);
});

export default router;
