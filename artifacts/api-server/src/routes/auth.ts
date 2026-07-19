import bcrypt from "bcrypt";
import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { RegisterUserBody, LoginUserBody, GetCurrentAuthUserResponse } from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
import { processReferralSignup } from "../lib/referrals.js";
import {
  clearSession,
  getSessionId,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
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
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input: " + parsed.error.issues[0]?.message });
    return;
  }

  const { email, password, name, referralCode } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? name.trim();
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  const [user] = await db
    .insert(usersTable)
    .values({
      id: crypto.randomUUID(),
      email: normalizedEmail,
      passwordHash,
      firstName,
      lastName,
      // New users get a 7-day full-access Editor trial.
      subscriptionStatus: "trial",
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      lastLoginAt: new Date(),
    })
    .returning();

  req.log.info({ userId: user.id, email: user.email }, "User registered");

  // Share-to-earn: credit referrer + new user. Never blocks or fails signup.
  if (referralCode) {
    await processReferralSignup(referralCode, user.id);
  }

  const payload = buildUserPayload(user);
  const sessionData: SessionData = { user: payload };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json(GetCurrentAuthUserResponse.parse({ user: payload }));
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);

  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (user.isDisabled) {
    res.status(403).json({ error: "This account has been disabled." });
    return;
  }

  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, user.id));

  req.log.info({ userId: user.id, email: user.email }, "User signed in");

  const payload = buildUserPayload(user);
  const sessionData: SessionData = { user: payload };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json(GetCurrentAuthUserResponse.parse({ user: payload }));
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
