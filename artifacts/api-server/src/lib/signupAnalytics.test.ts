import { describe, expect, it } from "vitest";
import {
  buildSignupCompletedEvent,
  buildSignupFailureEvent,
  getSignupAnonId,
  isClientSubmittedSignupEvent,
  safeSignupAnonId,
  signupCompletedEventId,
} from "./signupAnalytics.js";

describe("signup analytics identifiers and privacy boundaries", () => {
  it("derives one opaque, deterministic completion id per user", () => {
    const first = signupCompletedEventId("opaque-user-123");
    expect(first).toBe(signupCompletedEventId("opaque-user-123"));
    expect(first).not.toContain("opaque-user-123");
    expect(first).not.toBe(signupCompletedEventId("opaque-user-456"));
  });

  it("keeps successful metadata to the explicit source and category", () => {
    expect(
      buildSignupCompletedEvent("opaque-user-123", {
        anonId: "visitor-123",
        source: "referral",
      }),
    ).toEqual({
      id: signupCompletedEventId("opaque-user-123"),
      anonId: "visitor-123",
      userId: "opaque-user-123",
      eventType: "signup_completed",
      meta: { source: "referral", category: "account_creation" },
    });
  });

  it("categorizes failures without copying request data", () => {
    expect(buildSignupFailureEvent("validation", "visitor-123")).toMatchObject({
      anonId: "visitor-123",
      userId: null,
      eventType: "signup_failed",
      meta: { source: "register", category: "validation" },
    });
    expect(buildSignupFailureEvent("persistence", "email@example.test").meta).toEqual({
      source: "register",
      category: "persistence",
    });
  });

  it("bounds and validates the optional attribution header", () => {
    expect(safeSignupAnonId("visitor-123")).toBe("visitor-123");
    expect(safeSignupAnonId("x".repeat(65))).toBeNull();
    expect(safeSignupAnonId("visitor with spaces")).toBeNull();
    expect(safeSignupAnonId("email@example.test")).toBeNull();
    expect(
      getSignupAnonId({
        headers: { "x-analytics-anon-id": "visitor-456" },
      }),
    ).toBe("visitor-456");
    expect(
      getSignupAnonId({
        headers: { "x-analytics-anon-id": ["visitor-456", "spoofed"] },
      }),
    ).toBeNull();
  });

  it("rejects client-submitted signup outcome events", () => {
    expect(isClientSubmittedSignupEvent("signup_completed")).toBe(true);
    expect(isClientSubmittedSignupEvent("signup_failed")).toBe(true);
    expect(isClientSubmittedSignupEvent("signup_started")).toBe(false);
  });
});