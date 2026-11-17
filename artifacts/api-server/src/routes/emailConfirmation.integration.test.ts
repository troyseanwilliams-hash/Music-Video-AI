import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import pino from "pino";
import { db, usersTable, sessionsTable, analyticsEventsTable, creditsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import authRouter from "./auth.js";
import confirmationRouter from "./emailConfirmation.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { createSession } from "../lib/auth.js";

const mocks = vi.hoisted(() => ({ send: vi.fn(), welcome: vi.fn(), referral: vi.fn() }));
vi.mock("../lib/notifications.js", () => ({ notifyNewUser: vi.fn(), sendWelcomeEmail: mocks.welcome }));
vi.mock("../lib/referrals.js", () => ({ processReferralSignup: mocks.referral }));
vi.mock("../lib/emailConfirmation.js", async (original) => ({
  ...await original<typeof import("../lib/emailConfirmation.js")>(),
  sendEmailConfirmation: mocks.send,
}));

describe.skipIf(process.env.MFA_INTEGRATION_TESTS !== "1" || process.env.NODE_ENV === "production")("required new-account email confirmation", () => {
  let server: Server;
  let base: string;
  let id: string;
  let code: string;
  const email = `confirm-${randomUUID()}@example.invalid`;
  const password = `Fixture-${randomUUID()}`;
  async function request(path: string, body?: unknown, cookie?: string) {
    const result = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Origin: base, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: result.status, body: await result.json() as Record<string, any>, cookie: result.headers.get("set-cookie") };
  }
  beforeAll(async () => {
    vi.stubEnv("MAX_ACCOUNTS_PER_IP", "0");
    mocks.send.mockResolvedValue(true);
    const app = express();
    app.use((req, _res, next) => { req.log = pino({ enabled: false }); next(); });
    app.use(express.json(), cookieParser(), authMiddleware, authRouter, confirmationRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    if (id) {
      await db.delete(sessionsTable).where(sql`${sessionsTable.sess}->'user'->>'id' = ${id}`);
      await db.delete(analyticsEventsTable).where(eq(analyticsEventsTable.userId, id));
      await db.delete(usersTable).where(eq(usersTable.id, id));
    }
    vi.unstubAllEnvs();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it("creates an unconfirmed account and grant without creating a session", async () => {
    const response = await request("/auth/register", { name: "Confirmation Fixture", email, password, referralCode: "FIXTURE" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ requiresEmailVerification: true, emailSent: true });
    expect(response.cookie).toBeNull();
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    id = user.id;
    code = mocks.send.mock.calls[0][2];
    expect(user.emailVerificationRequired).toBe(true);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.emailVerificationHash).not.toBe(code);
    expect(user.lastLoginAt).toBeNull();
    const [credits] = await db.select().from(creditsTable).where(eq(creditsTable.userId, id));
    expect(credits.welcomeCredits).toBeGreaterThan(0);
    expect(mocks.welcome).not.toHaveBeenCalled();
    expect(mocks.referral).not.toHaveBeenCalled();
  });
  it("blocks password sign-in and even an existing session for unconfirmed accounts", async () => {
    expect((await request("/auth/login", { email, password })).body).toEqual({ requiresEmailVerification: true });
    const sid = await createSession({ user: { id, email, firstName: "Fixture", lastName: null, profileImageUrl: null, subscriptionStatus: "trial", trialEndsAt: null, isAdmin: false } });
    expect((await request("/auth/user", undefined, `sid=${sid}`)).body.user).toBeNull();
  });
  it("requires the password and rejects incorrect, expired and recently resent codes", async () => {
    expect((await request("/auth/email-confirmation", { action: "confirm", email, password: "incorrect", code })).status).toBe(401);
    expect((await request("/auth/email-confirmation", { action: "confirm", email, password, code: "invalid" })).status).toBe(400);
    expect((await request("/auth/email-confirmation", { action: "resend", email, password })).status).toBe(429);
    await db.update(usersTable).set({ emailVerificationExpiresAt: new Date(0), emailVerificationSentAt: new Date(0) }).where(eq(usersTable.id, id));
    expect((await request("/auth/email-confirmation", { action: "confirm", email, password, code })).status).toBe(400);
    const resent = await request("/auth/email-confirmation", { action: "resend", email, password });
    expect(resent.body).toEqual({ verified: false, emailSent: true });
    const newCode = mocks.send.mock.calls.at(-1)![2];
    if (newCode !== code) expect((await request("/auth/email-confirmation", { action: "confirm", email, password, code })).status).toBe(400);
    code = newCode;
  });
  it("reports delivery failure without opening the account", async () => {
    await db.update(usersTable).set({ emailVerificationSentAt: new Date(0) }).where(eq(usersTable.id, id));
    mocks.send.mockResolvedValueOnce(false);
    expect((await request("/auth/email-confirmation", { action: "resend", email, password })).body).toEqual({ verified: false, emailSent: false });
    expect((await request("/auth/login", { email, password })).body.requiresEmailVerification).toBe(true);
    await db.update(usersTable).set({ emailVerificationSentAt: new Date(0) }).where(eq(usersTable.id, id));
    await request("/auth/email-confirmation", { action: "resend", email, password });
    code = mocks.send.mock.calls.at(-1)![2];
  });
  it("confirms once, sends welcome once, and allows normal sign-in afterward", async () => {
    const confirmed = await request("/auth/email-confirmation", { action: "confirm", email, password, code });
    expect(confirmed.body).toEqual({ verified: true });
    expect(confirmed.cookie).toBeNull();
    expect((await request("/auth/email-confirmation", { action: "confirm", email, password, code })).body).toEqual({ verified: true });
    expect(mocks.welcome).toHaveBeenCalledTimes(1);
    expect(mocks.referral).toHaveBeenCalledTimes(1);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.emailVerificationHash).toBeNull();
    const signedIn = await request("/auth/login", { email, password });
    expect(signedIn.body.user.id).toBe(id);
    expect(signedIn.cookie).toContain("sid=");
  });
});
