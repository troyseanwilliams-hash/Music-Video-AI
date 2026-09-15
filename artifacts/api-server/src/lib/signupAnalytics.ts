import { createHash, randomUUID } from "node:crypto";

/**
 * Optional browser context for signup attribution. It is deliberately a
 * header, rather than part of the registration body, so it is not an
 * authentication or API contract field.
 */
export const SIGNUP_ANON_ID_HEADER = "x-analytics-anon-id";

const ANON_ID_PATTERN = /^[a-zA-Z0-9-]{1,64}$/;

export const SIGNUP_FAILURE_CATEGORIES = [
  "validation",
  "duplicate",
  "rate_limited",
  "persistence",
] as const;

export type SignupFailureCategory = (typeof SIGNUP_FAILURE_CATEGORIES)[number];
export type SignupSource = "direct" | "referral";

export interface SignupAnalyticsEvent {
  id: string;
  anonId: string | null;
  userId: string | null;
  eventType: "signup_completed" | "signup_failed";
  meta: {
    source: SignupSource | "register";
    category: "account_creation" | SignupFailureCategory;
  };
}

/**
 * Validate the opaque visitor identifier carried by the browser. Never use
 * this helper for IP addresses, emails, request bodies, or other identifiers.
 */
export function safeSignupAnonId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ANON_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Read the optional attribution header without changing the registration API
 * body. Express normalizes request header names to lowercase, but accepting a
 * small request-like shape keeps this helper easy to test.
 */
export function getSignupAnonId(req: {
  get?: (name: string) => string | undefined;
  headers?: Record<string, string | string[] | undefined>;
}): string | null {
  const fromGetter = req.get?.(SIGNUP_ANON_ID_HEADER);
  const fromHeaders = req.headers?.[SIGNUP_ANON_ID_HEADER];
  const value = fromGetter ?? (typeof fromHeaders === "string" ? fromHeaders : undefined);
  return safeSignupAnonId(value);
}

/**
 * A user id is already an opaque server identifier. Hashing it with an event
 * namespace keeps the deterministic primary key from exposing that id in
 * analytics exports while making retries/calls idempotent.
 */
export function signupCompletedEventId(userId: string): string {
  return createHash("sha256")
    .update(`analytics:signup_completed:${userId}`, "utf8")
    .digest("hex");
}

export function buildSignupCompletedEvent(
  userId: string,
  options: { anonId?: string | null; source: SignupSource },
): SignupAnalyticsEvent {
  return {
    id: signupCompletedEventId(userId),
    anonId: safeSignupAnonId(options.anonId),
    userId,
    eventType: "signup_completed",
    meta: {
      source: options.source,
      category: "account_creation",
    },
  };
}

export function buildSignupFailureEvent(
  category: SignupFailureCategory,
  anonId?: string | null,
): SignupAnalyticsEvent {
  return {
    id: randomUUID(),
    anonId: safeSignupAnonId(anonId),
    userId: null,
    eventType: "signup_failed",
    meta: {
      source: "register",
      category,
    },
  };
}

/**
 * Signup outcomes are server-authoritative. The public collector must never
 * accept browser-supplied success/failure events with these names, even when
 * the request is authenticated. Server auth.ts writes signup_failed directly
 * for categorized request outcomes.
 */
export function isClientSubmittedSignupEvent(eventType: unknown): boolean {
  return eventType === "signup_completed" || eventType === "signup_failed";
}