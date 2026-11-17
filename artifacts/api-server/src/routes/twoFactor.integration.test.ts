import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import pino from "pino";
import { TOTP } from "otpauth";
import { db, usersTable, sessionsTable, twoFactorTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import authRouter from "./auth.js";
import twoFactorRouter from "./twoFactor.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { allowAuthAttempt } from "../lib/twoFactor.js";

// These tests insert only their own synthetic user, never register/send email.
vi.mock("../lib/notifications.js", () => ({ notifyNewUser: vi.fn(), sendWelcomeEmail: vi.fn() }));
vi.mock("../lib/referrals.js", () => ({ processReferralSignup: vi.fn() }));

describe.skipIf(process.env.MFA_INTEGRATION_TESTS !== "1" || process.env.NODE_ENV === "production")("optional two-factor account lifecycle", () => {
  let server: Server;
  let base: string;
  const userId = randomUUID();
  const email = `mfa-${userId}@example.invalid`;
  let password = `Fixture-only-${randomUUID()}`;
  let cookie = "";
  let oldCookie = "";
  let seed = "";
  let codes: string[] = [];

  async function request(path: string, body?: unknown, session = "", origin?: string) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Origin: origin ?? base, ...(session ? { Cookie: session } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as Record<string, any>, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "", cache: response.headers.get("cache-control") };
  }

  beforeAll(async () => {
    await db.insert(usersTable).values({ id: userId, email, passwordHash: await bcrypt.hash(password, 4) });
    const app = express();
    app.use((req, _res, next) => { req.log = pino({ enabled: false }); next(); });
    app.use(express.json(), cookieParser(), authMiddleware, authRouter, twoFactorRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await db.delete(sessionsTable).where(sql`${sessionsTable.sess}->'user'->>'id' = ${userId}`);
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("keeps existing password sign-in available until users opt in", async () => {
    const login = await request("/auth/login", { email, password });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(userId);
    cookie = login.cookie;
    oldCookie = (await request("/auth/login", { email, password })).cookie;
    expect((await request("/auth/two-factor", undefined, cookie)).body.enabled).toBe(false);
    expect((await request("/auth/two-factor")).status).toBe(401);
    expect((await request("/auth/login", { email, password: "incorrect" })).status).toBe(401);
  });
  it("rejects cross-origin access and incorrect enrollment passwords", async () => {
    expect((await request("/auth/two-factor", { action: "setup", password }, cookie, "https://evil.invalid")).status).toBe(403);
    expect((await request("/auth/two-factor", { action: "setup", password: "incorrect" }, cookie)).status).toBe(401);
  });
  it("keeps setup pending until a valid code, stores an encrypted seed and expires setup", async () => {
    const setup = await request("/auth/two-factor", { action: "setup", password }, cookie);
    expect(setup.status).toBe(200);
    expect(setup.cache).toBe("no-store");
    expect(setup.body.qrCode).toMatch(/^data:image\/png;base64,/);
    expect((await request("/auth/two-factor", undefined, cookie)).body.enabled).toBe(false);
    expect((await request("/auth/two-factor", { action: "enable", password, code: "invalid" }, cookie)).status).toBe(401);
    await db.update(twoFactorTable).set({ pendingExpiresAt: new Date(0) }).where(eq(twoFactorTable.userId, userId));
    expect((await request("/auth/two-factor", { action: "enable", password, code: "123456" }, cookie)).status).toBe(400);
    const fresh = await request("/auth/two-factor", { action: "setup", password }, cookie);
    seed = fresh.body.secret;
    const [record] = await db.select().from(twoFactorTable).where(eq(twoFactorTable.userId, userId));
    expect(record.encryptedSecret).not.toContain(seed);
    const token = new TOTP({ secret: seed }).generate();
    const enabled = await request("/auth/two-factor", { action: "enable", password, code: token }, cookie);
    expect(enabled.status).toBe(200);
    codes = enabled.body.recoveryCodes;
    expect(codes).toHaveLength(10);
    expect((await request("/auth/two-factor", undefined, oldCookie)).status).toBe(401);
    expect((await request("/auth/two-factor", undefined, cookie)).body.enabled).toBe(true);
    expect((await request("/auth/login", { email, password, code: token })).status).toBe(401);
  });
  it("never issues a session for a missing or bad second factor", async () => {
    const partial = await request("/auth/login", { email, password });
    expect(partial.body).toEqual({ requiresTwoFactor: true });
    expect(partial.cookie).toBe("");
    expect((await request("/auth/login", { email, password, code: "invalid" })).status).toBe(401);
  });
  it("accepts a fresh authenticator code and rejects its replay", async () => {
    const code = new TOTP({ secret: seed }).generate({ timestamp: Date.now() + 30_000 });
    expect((await request("/auth/login", { email, password, code })).body.user.id).toBe(userId);
    expect((await request("/auth/login", { email, password, code })).status).toBe(401);
  });
  it("atomically consumes recovery codes, including simultaneous sign-ins", async () => {
    const attempts = await Promise.all([0, 1].map(() => request("/auth/login", { email, password, code: codes[0] })));
    expect(attempts.map((a) => a.status).sort()).toEqual([200, 401]);
    expect((await request("/auth/two-factor", undefined, cookie)).body.recoveryCodesRemaining).toBe(9);
    expect((await request("/auth/login", { email, password, code: codes[0] })).status).toBe(401);
  });
  it("rejects disabled accounts even with correct credentials and recovery code", async () => {
    await db.update(usersTable).set({ isDisabled: true }).where(eq(usersTable.id, userId));
    expect((await request("/auth/login", { email, password, code: codes[1] })).status).toBe(403);
    await db.update(usersTable).set({ isDisabled: false }).where(eq(usersTable.id, userId));
  });
  it("keeps the second factor required after password reset and revokes old sessions", async () => {
    const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    await db.update(usersTable).set({
      passwordResetToken: createHash("sha256").update(token).digest("hex"),
      passwordResetExpires: new Date(Date.now() + 60_000),
    }).where(eq(usersTable.id, userId));
    password = `Updated-fixture-${randomUUID()}`;
    expect((await request("/auth/reset-password", { token, password })).status).toBe(200);
    expect((await request("/auth/login", { email, password })).body.requiresTwoFactor).toBe(true);
    expect((await request("/auth/two-factor", undefined, cookie)).status).toBe(401);
    const login = await request("/auth/login", { email, password, code: codes[9] });
    expect(login.status).toBe(200);
    cookie = login.cookie;
  });
  it("replaces old recovery codes and requires both factors to disable", async () => {
    const replaced = await request("/auth/two-factor", { action: "recovery", password, code: codes[1] }, cookie);
    expect(replaced.status).toBe(200);
    expect((await request("/auth/login", { email, password, code: codes[2] })).status).toBe(401);
    codes = replaced.body.recoveryCodes;
    expect((await request("/auth/two-factor", { action: "disable", password }, cookie)).status).toBe(401);
    expect((await request("/auth/two-factor", { action: "disable", password: "bad", code: codes[0] }, cookie)).status).toBe(401);
    expect((await request("/auth/two-factor", { action: "disable", password, code: codes[0] }, cookie)).body.enabled).toBe(false);
    expect((await request("/auth/login", { email, password })).body.user.id).toBe(userId);
  });
  it("enforces a shared atomic attempt limit", async () => {
    const results = await Promise.all([0, 1, 2].map(() => allowAuthAttempt(`fixture:${userId}`, 2)));
    expect(results.filter(Boolean)).toHaveLength(2);
  });
});
