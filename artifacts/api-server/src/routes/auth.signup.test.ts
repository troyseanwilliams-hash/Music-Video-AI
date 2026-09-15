import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  tx: {
    insert: vi.fn(),
  },
  bcrypt: {
    hash: vi.fn(),
  },
  createSession: vi.fn(),
  notifyNewUser: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  processReferralSignup: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: mocks.db,
}));

vi.mock("bcrypt", () => ({ default: mocks.bcrypt }));
vi.mock("../lib/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/auth.js")>()),
  createSession: mocks.createSession,
}));
vi.mock("../lib/notifications.js", () => ({
  notifyNewUser: mocks.notifyNewUser,
  sendWelcomeEmail: mocks.sendWelcomeEmail,
}));
vi.mock("../lib/referrals.js", () => ({
  processReferralSignup: mocks.processReferralSignup,
}));

import router from "./auth.js";
import { analyticsEventsTable, usersTable } from "@workspace/db";

type FakeResponse = {
  statusCode: number;
  body: unknown;
  cookie: ReturnType<typeof vi.fn>;
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
};

function response(): FakeResponse {
  return {
    statusCode: 200,
    body: null,
    cookie: vi.fn(),
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function registrationHandler() {
  const layer = (router as any).stack.find(
    (candidate: any) =>
      candidate.route?.path === "/auth/register" &&
      candidate.route?.methods?.post,
  );
  return layer.route.stack[0].handle as (req: any, res: FakeResponse) => Promise<void>;
}

function request(body: Record<string, unknown> = {}) {
  return {
    body,
    headers: { "x-analytics-anon-id": "visitor-123" },
    get(name: string) {
      return this.headers[name.toLowerCase() as keyof typeof this.headers];
    },
    ip: "192.0.2.1",
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  };
}

const user = {
  id: "opaque-user-123",
  email: "new@example.test",
  passwordHash: "hash",
  firstName: "New",
  lastName: "User",
  profileImageUrl: null,
  subscriptionStatus: "trial",
  trialEndsAt: new Date(),
  lastLoginAt: new Date(),
  signupIp: "192.0.2.1",
  isDisabled: false,
  copyrightAcceptedAt: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  billingCheckoutPendingUntil: null,
  referralCode: null,
  passwordResetToken: null,
  passwordResetExpires: null,
  trialAlignsUsed: 0,
  notifyOnComplete: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function selectEmpty() {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: vi.fn(async () => []),
  };
  return builder;
}

describe("registration signup measurement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bcrypt.hash.mockResolvedValue("hash");
    mocks.createSession.mockResolvedValue("session-id");
    mocks.notifyNewUser.mockResolvedValue(undefined);
    mocks.sendWelcomeEmail.mockResolvedValue(undefined);
    mocks.processReferralSignup.mockResolvedValue(undefined);

    mocks.db.select.mockImplementation(selectEmpty);

    const userInsert = {
      values: vi.fn(() => userInsert),
      returning: vi.fn(async () => [user]),
    };
    const eventInsert = {
      values: vi.fn(() => eventInsert),
      onConflictDoNothing: vi.fn(async () => []),
    };
    mocks.tx.insert.mockImplementation((table: unknown) =>
      table === usersTable ? userInsert : eventInsert,
    );
    mocks.db.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(mocks.tx),
    );
    mocks.db.insert.mockImplementation(() => ({
      values: vi.fn(async () => []),
    }));
  });

  it("commits the account and completion event in one transaction", async () => {
    const res = response();
    await registrationHandler()(
      request({ name: "New User", email: "new@example.test", password: "password123" }),
      res,
    );

    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.insert).toHaveBeenCalledWith(usersTable);
    expect(mocks.tx.insert).toHaveBeenCalledWith(analyticsEventsTable);
    const eventBuilder = mocks.tx.insert.mock.results[1]?.value;
    expect(eventBuilder.values).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
      anonId: "visitor-123",
      userId: user.id,
      eventType: "signup_completed",
      meta: { source: "direct", category: "account_creation" },
    }));
    expect(eventBuilder.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("does not commit an account when the completion event insert fails", async () => {
    const eventInsert = {
      values: vi.fn(() => eventInsert),
      onConflictDoNothing: vi.fn(async () => {
        throw new Error("analytics unavailable");
      }),
    };
    mocks.tx.insert.mockImplementation((table: unknown) =>
      table === usersTable
        ? {
            values: vi.fn(() => ({
              returning: vi.fn(async () => [user]),
            })),
          }
        : eventInsert,
    );

    let transactionCommitted = false;
    mocks.db.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      try {
        const result = await callback(mocks.tx);
        transactionCommitted = true;
        return result;
      } catch (error) {
        transactionCommitted = false;
        throw error;
      }
    });

    await expect(
      registrationHandler()(
        request({ name: "New User", email: "new@example.test", password: "password123" }),
        response(),
      ),
    ).rejects.toThrow("analytics unavailable");

    expect(transactionCommitted).toBe(false);
    expect(mocks.tx.insert).toHaveBeenCalledWith(usersTable);
    expect(mocks.tx.insert).toHaveBeenCalledWith(analyticsEventsTable);
    // Failure categorization is separate and best effort after rollback.
    expect(mocks.db.insert).toHaveBeenCalledWith(analyticsEventsTable);
  });

  it("categorizes duplicate signup attempts without creating a user", async () => {
    mocks.db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: vi.fn(async () => [{ id: "existing-user" }]),
        }),
      }),
    }));

    const res = response();
    await registrationHandler()(
      request({ name: "New User", email: "new@example.test", password: "password123" }),
      res,
    );

    expect(res.statusCode).toBe(409);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.db.insert).toHaveBeenCalledWith(analyticsEventsTable);
    expect(mocks.db.insert.mock.results[0]?.value.values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "signup_failed",
        meta: { source: "register", category: "duplicate" },
      }),
    );
  });
});