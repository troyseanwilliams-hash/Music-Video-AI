import bcrypt from "bcrypt";
import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { RegisterUserBody, RegisterUserResponse, LoginUserBody, GetCurrentAuthUserResponse } from "@workspace/api-zod";
import { db, analyticsEventsTable, usersTable, creditsTable, creditGrantsTable, twoFactorTable } from "@workspace/db";
import { allowAuthAttempt, authOriginGuard, verifySecondFactor } from "../lib/twoFactor.js";
import { newEmailCode, sendEmailConfirmation } from "../lib/emailConfirmation.js";
import { eq, sql } from "drizzle-orm";
import { isDisposableEmail } from "../lib/emailPolicy.js";
import { hasDeletedEmail, recordDeletedEmail } from "../lib/deletedEmails.js";
import { maxAccountsPerIp as getMaxAccountsPerIp, signupIpWindowDays, signupIpWindowStart } from "../lib/signupLimits.js";

function isAdminEmail(email: string | null | undefined): boolean {
  return !!(process.env.ADMIN_EMAIL && email && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
}

function buildUserPayload(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
    subscriptionStatus: (user.subscriptionStatus ?? "none") as "trial" | "active" | "cancelled" | "none",
    trialEndsAt: user.trialEndsAt ?? null,
    isAdmin: isAdminEmail(user.email),
  };
}
import { WELCOME_CREDITS } from "../lib/welcomeOffer.js";
import { notifyNewUser } from "../lib/notifications.js";
import { emailShell, ctaButton } from "../lib/emailTemplates.js";
import { z } from "zod";
import { Resend } from "resend";
import { and, gt, gte } from "drizzle-orm";
import {
  buildSignupCompletedEvent,
  buildSignupFailureEvent,
  getSignupAnonId,
  type SignupFailureCategory,
} from "../lib/signupAnalytics.js";
import {
  clearSession,
  getSessionId,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
} from "../lib/auth.js";

const SALT_ROUNDS = 12;

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

/**
 * Signup measurement is best effort for failed attempts: a failure must not
 * make the registration endpoint less reliable, while a successful account
 * always records its completion event inside the account transaction below.
 */
async function recordSignupFailure(
  req: Request,
  category: SignupFailureCategory,
  anonId: string | null,
): Promise<void> {
  try {
    await db.insert(analyticsEventsTable).values(buildSignupFailureEvent(category, anonId));
  } catch (err) {
    req.log?.warn({ err, category }, "signup failure analytics write failed (ignored)");
  }
}

router.get("/auth/user", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.json(GetCurrentAuthUserResponse.parse({ user: null }));
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  if (!user) {
    res.json(GetCurrentAuthUserResponse.parse({ user: null }));
    return;
  }
  res.json(GetCurrentAuthUserResponse.parse({ user: buildUserPayload(user) }));
});

router.post("/auth/register", async (req: Request, res: Response) => {
  const anonId = getSignupAnonId(req);
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    await recordSignupFailure(req, "validation", anonId);
    res.status(400).json({ error: "Invalid input: " + parsed.error.issues[0]?.message });
    return;
  }

  const { email, password, name, referralCode } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  if (isDisposableEmail(normalizedEmail)) {
    await recordSignupFailure(req, "validation", anonId);
    res.status(400).json({
      error: "Please use a permanent email address. Temporary inboxes can't receive your confirmation code reliably.",
      code: "DISPOSABLE_EMAIL",
    });
    return;
  }

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);

  if (existing.length > 0) {
    await recordSignupFailure(req, "duplicate", anonId);
    res.status(409).json({ error: "An account with that email already exists. Sign in to continue or resend its confirmation code." });
    return;
  }

  // Anti-abuse: cap new accounts per client IP within a rolling window, so a
  // shared network is not locked out forever. req.ip is the real client (trust
  // proxy is enabled). Tune with MAX_ACCOUNTS_PER_IP (0 = off) and
  // SIGNUP_IP_WINDOW_DAYS.
  const signupIp = (req.ip || "").toString().trim();
  const maxAccountsPerIp = getMaxAccountsPerIp();
  if (signupIp && maxAccountsPerIp > 0) {
    const priorFromIp = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.signupIp, signupIp),
        gte(usersTable.createdAt, signupIpWindowStart(Date.now(), signupIpWindowDays())),
      ))
      .limit(maxAccountsPerIp);
    if (priorFromIp.length >= maxAccountsPerIp) {
      req.log.warn({ signupIp, email: normalizedEmail }, "Registration blocked: too many accounts from this IP");
      await recordSignupFailure(req, "rate_limited", anonId);
      res.status(429).json({
        error:
          "We've reached the limit of new accounts from your network. If you need another account, please contact support.",
        code: "TOO_MANY_ACCOUNTS",
      });
      return;
    }
  }

  // A returning address (its account was closed) does not get the one-time
  // welcome credits again; everything else about signup is unchanged.
  // Fails open: if the ledger is unreachable (e.g. the table has not been
  // pushed yet) signup must keep working, so we log and grant as before.
  let returningAddress = false;
  try {
    returningAddress = await hasDeletedEmail(db, normalizedEmail);
  } catch (err) {
    req.log.error({ err }, "Deleted-email ledger lookup failed; granting welcome credits");
  }
  const welcomeAmount = returningAddress ? 0 : WELCOME_CREDITS;

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? name.trim();
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
  const newUserId = crypto.randomUUID();
  const confirmation = newEmailCode(newUserId);

  let user: typeof usersTable.$inferSelect;
  try {
    [user] = await db.transaction(async (tx) => {
      const created = await tx
        .insert(usersTable)
        .values({
          id: newUserId,
          email: normalizedEmail,
          passwordHash,
          firstName,
          lastName,
          emailVerificationRequired: true,
          emailVerificationHash: confirmation.hash,
          emailVerificationExpiresAt: confirmation.expiresAt,
          emailVerificationSentAt: new Date(),
          pendingReferralCode: referralCode ?? null,
          // Retain the internal Editor access window, independently of welcome credits.
          subscriptionStatus: "trial",
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          lastLoginAt: null,
          signupIp: signupIp || null,
        })
        .returning();
      const createdUser = created[0];
      if (!createdUser) {
        throw new Error("Registration did not create an account");
      }

      // Grant exactly once on account creation, in the same transaction. A
      // duplicate email fails its unique constraint and rolls everything back;
      // login and lazy credits-row creation cannot grant this offer.
      await tx.insert(creditsTable).values({
        id: crypto.randomUUID(),
        userId: createdUser.id,
        creditsRemaining: welcomeAmount,
        welcomeCredits: welcomeAmount,
      });
      if (welcomeAmount > 0) {
        await tx.insert(creditGrantsTable).values({
          id: crypto.randomUUID(),
          userId: createdUser.id,
          source: "trial",
          creditsGranted: welcomeAmount,
        });
      }

      // The event id is derived from this opaque new user id. The primary key
      // plus onConflictDoNothing makes retries idempotent and this insert is
      // committed/rolled back with the account itself.
      await tx
        .insert(analyticsEventsTable)
        .values(
          buildSignupCompletedEvent(createdUser.id, {
            anonId,
            source: referralCode ? "referral" : "direct",
          }),
        )
        .onConflictDoNothing();

      return [createdUser];
    });
  } catch (err) {
    await recordSignupFailure(req, "persistence", anonId);
    throw err;
  }

  req.log.info({ userId: user.id, email: user.email }, "User registered");

  // Best-effort admin notification of the new signup (never blocks signup).
  notifyNewUser({ id: user.id, email: user.email, name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null });
  // No session or app access until the email is confirmed. Welcome/referral
  // side effects wait for confirmation; the existing signup grant stays atomic.
  const emailSent = await sendEmailConfirmation(user.id, normalizedEmail, confirmation.code);
  res.setHeader("Cache-Control", "no-store");
  res.json(RegisterUserResponse.parse({ requiresEmailVerification: true, emailSent }));
});

router.post("/auth/login", authOriginGuard, async (req: Request, res: Response) => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const { email, password, code } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();
  if (!(await allowAuthAttempt(`login-ip:${req.ip}`, 100)) ||
      !(await allowAuthAttempt(`login-account:${normalizedEmail}`, 30))) {
    res.status(429).json({ error: "Too many sign-in attempts. Please wait 15 minutes before trying again." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).for("update");
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return { status: 401, body: { error: "Invalid email or password" } };
    }
    if (user.isDisabled) return { status: 403, body: { error: "This account has been disabled." } };
    if (user.emailVerificationRequired && !user.emailVerifiedAt) {
      return { status: 200, body: { requiresEmailVerification: true } };
    }
    const [mfa] = await tx.select().from(twoFactorTable).where(eq(twoFactorTable.userId, user.id));
    if (mfa?.enabled) {
      if (!code) return { status: 200, body: { requiresTwoFactor: true } };
      if (!(await verifySecondFactor(tx, user.id, code))) {
        return { status: 401, body: { error: "Invalid or already-used code. Try a new authenticator code or an unused recovery code." } };
      }
    }
    const payload = buildUserPayload(user);
    const sid = await createSession({ user: payload, authVersion: user.authVersion }, tx);
    await tx.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    return { status: 200, body: GetCurrentAuthUserResponse.parse({ user: payload }), sid };
  });
  if (result.sid) setSessionCookie(res, result.sid);
  res.status(result.status).json(result.body);
});

const APP_URL = process.env.APP_URL ?? "https://aibeatsync.com";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Always responds 200 (no account enumeration). If the account exists, emails
// a one-hour reset link.
router.post("/auth/forgot-password", async (req: Request, res: Response) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  const normalizedEmail = parsed.data.email.toLowerCase().trim();
  res.json({ ok: true }); // respond immediately, do the work after

  try {
    const [user] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);
    if (!user) return;

    const token = crypto.randomBytes(32).toString("hex");
    await db
      .update(usersTable)
      .set({
        passwordResetToken: hashResetToken(token),
        passwordResetExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      })
      .where(eq(usersTable.id, user.id));

    if (!process.env.RESEND_API_KEY) {
      req.log.warn("RESEND_API_KEY not set — reset email skipped");
      return;
    }
    const resetUrl = `${APP_URL}/reset-password?token=${token}`;
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "AIBeatSync <notifications@aibeatsync.com>",
      to: user.email!,
      subject: "Reset your AIBeatSync password",
      html: emailShell(
        `
          <h1 style="font-size:22px;margin:0 0 12px">Reset your password 🔐</h1>
          <p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 8px">
            We received a request to reset your AIBeatSync password. This link expires in <strong>1 hour</strong>.
          </p>
          ${ctaButton(resetUrl, "Choose a new password →")}
          <p style="font-size:13px;line-height:1.6;color:#666;margin:0">
            If you didn't request this, you can safely ignore this email — your password won't change.
          </p>
        `,
      ),
    });
    req.log.info({ userId: user.id }, "Password reset email sent");
  } catch (err) {
    req.log.error({ err }, "Failed to process forgot-password");
  }
});

router.post("/auth/reset-password", async (req: Request, res: Response) => {
  const parsed = z
    .object({ token: z.string().min(32), password: z.string().min(8) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Token and a password of at least 8 characters are required" });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.passwordResetToken, hashResetToken(parsed.data.token)),
        gt(usersTable.passwordResetExpires, new Date()),
      ),
    )
    .limit(1);

  if (!user) {
    res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, SALT_ROUNDS);
  await db
    .update(usersTable)
    .set({ passwordHash, passwordResetToken: null, passwordResetExpires: null, authVersion: sql`${usersTable.authVersion} + 1` })
    .where(and(eq(usersTable.id, user.id), eq(usersTable.passwordResetToken, hashResetToken(parsed.data.token)), gt(usersTable.passwordResetExpires, new Date())));

  req.log.info({ userId: user.id }, "Password reset completed");
  res.json({ ok: true });
});

// Update profile (display name). Writes existing users columns — no schema change.
router.patch("/auth/profile", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = z
    .object({
      firstName: z.string().trim().max(60).optional(),
      lastName: z.string().trim().max(60).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid name" });
    return;
  }
  await db
    .update(usersTable)
    .set({
      ...(parsed.data.firstName !== undefined ? { firstName: parsed.data.firstName || null } : {}),
      ...(parsed.data.lastName !== undefined ? { lastName: parsed.data.lastName || null } : {}),
    })
    .where(eq(usersTable.id, req.user.id));
  res.json({ ok: true });
});

// Account preferences (currently just the render-finished email opt-out).
router.patch("/auth/preferences", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = z.object({ notifyOnComplete: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "notifyOnComplete (boolean) is required" });
    return;
  }
  await db
    .update(usersTable)
    .set({ notifyOnComplete: parsed.data.notifyOnComplete })
    .where(eq(usersTable.id, req.user.id));
  res.json({ ok: true, notifyOnComplete: parsed.data.notifyOnComplete });
});

router.get("/auth/preferences", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db
    .select({ notifyOnComplete: usersTable.notifyOnComplete })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);
  res.json({ notifyOnComplete: user?.notifyOnComplete ?? true });
});

// DELETE /api/auth/account — self-service account closure. Requires the
// current password as confirmation.
//
// This is a SOFT close, not a hard delete — matching how individual videos
// already work in this app (DELETE /videos/:id marks deletedAt rather than
// removing the row/files; see routes/videos.ts). usersTable.id cascades
// via onDelete: "cascade" into videos, soundtracks, credits, referrals,
// support tickets, and promo redemptions — a hard delete here would wipe
// all of that, including financial/audit records and other users' referral
// history that shouldn't disappear just because this account closed. So
// instead: disable login, clear the password hash so it can never succeed
// even if isDisabled were bypassed, and scrub the directly-identifying
// fields (email, name). Content stays in place, same as a soft-deleted
// video — an admin/auto-purge process is the right place to actually
// remove it later, not this endpoint.
//
// Does NOT cancel an active Stripe subscription — that's a separate,
// deliberate action a user takes via "Manage billing & plan" in Settings,
// not something to do silently as a side effect of closing the account.
const deleteAccountBodySchema = z.object({
  password: z.string().min(1, "Enter your password to confirm"),
});

router.delete("/auth/account", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = deleteAccountBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Password confirmation is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const validPassword = user.passwordHash ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
  if (!validPassword) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  // Remember the address BEFORE it is scrubbed, so re-registering it cannot
  // claim the welcome credits a second time. Fails open: a ledger problem must
  // never stop a user from closing their account (it is logged for follow-up).
  if (user.email) {
    try {
      await recordDeletedEmail(db, user.email);
    } catch (err) {
      req.log.error({ err, userId: user.id }, "Could not record deleted email in ledger");
    }
  }

  await db
    .update(usersTable)
    .set({
      isDisabled: true,
      email: null,
      passwordHash: null,
      firstName: null,
      lastName: null,
      profileImageUrl: null,
      passwordResetToken: null,
      passwordResetExpires: null,
    })
    .where(eq(usersTable.id, req.user.id));

  req.log.info({ userId: req.user.id }, "Account closed by user (self-service)");

  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.status(204).end();
});

router.get("/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.redirect("/");
});

router.post("/mobile-auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) await deleteSession(sid);
  res.json({ success: true });
});

export default router;
