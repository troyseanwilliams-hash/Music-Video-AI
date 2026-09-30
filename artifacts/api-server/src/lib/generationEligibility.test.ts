import { describe, expect, it } from "vitest";
import { canCreateCreditFundedMedia } from "./generationEligibility.js";
import { calculateCreditCost, calculateGeneratedImageCost, freeSoundtracksFor } from "./creditCost.js";
import { WELCOME_CREDITS } from "./welcomeOffer.js";

describe("credit-funded generation entitlement", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  it("allows an active plan and an unexpired internal trial", () => {
    expect(canCreateCreditFundedMedia({ subscriptionStatus: "active" }, now)).toBe(true);
    expect(canCreateCreditFundedMedia({ subscriptionStatus: "trial", trialEndsAt: new Date(now + 1000) }, now)).toBe(true);
  });
  it("rejects expired trials and pending billing statuses", () => {
    expect(canCreateCreditFundedMedia({ subscriptionStatus: "trial", trialEndsAt: new Date(now) }, now)).toBe(false);
    expect(canCreateCreditFundedMedia({ subscriptionStatus: "trialing", trialEndsAt: new Date(now + 1000) }, now)).toBe(false);
    expect(canCreateCreditFundedMedia({ subscriptionStatus: "incomplete", trialEndsAt: new Date(now + 1000) }, now)).toBe(false);
    expect(canCreateCreditFundedMedia({ subscriptionStatus: "none", trialEndsAt: new Date(now + 1000) }, now)).toBe(false);
  });
  it("keeps a five-second Kling video with its generated image within the welcome balance", () => {
    const firstVideo = calculateCreditCost("5", "720p", null, "kling", "narrative")
      + calculateGeneratedImageCost("5", null, "narrative");
    expect(firstVideo).toBe(54);
    expect(WELCOME_CREDITS - firstVideo).toBe(96);
  });
  it("retains the existing paid-tier instrumental limits, but no introductory free music", () => {
    expect(freeSoundtracksFor("starter")).toBe(25);
    expect(freeSoundtracksFor("pro")).toBe(100);
    expect(freeSoundtracksFor("studio")).toBe(300);
    expect(freeSoundtracksFor(null)).toBe(0);
  });
});