import { describe, expect, it } from "vitest";
import {
  advancedDraftItems, affordableNextSteps, formatExpiry, getStarterCost, hasGenerateHandoff,
  isAiEligible, isStarterDismissed, markStarterDismissed, pickStarterPath,
} from "./starterVideo";

describe("starter video", () => {
  it("costs 47 video + 7 image = 54 with current formulas", () => {
    expect(getStarterCost()).toEqual({ video: 47, images: 7, total: 54 });
  });
  it("fits inside the 150 welcome credits", () => {
    expect(getStarterCost().total).toBeLessThanOrEqual(150);
    expect(pickStarterPath(150)).toBe("starter");
  });
  it("offers lower-cost alternatives when short", () => {
    expect(pickStarterPath(53)).toBe("images");
    expect(pickStarterPath(6)).toBe("montage");
    expect(pickStarterPath(null)).toBe("unknown");
    expect(pickStarterPath(0, true)).toBe("starter");
  });
  it("lists only affordable next steps", () => {
    expect(affordableNextSteps(96)).toEqual(["starter_video", "images", "montage"]);
    expect(affordableNextSteps(10)).toEqual(["images", "montage"]);
    expect(affordableNextSteps(0)).toEqual(["montage"]);
  });
  it("formats expiry", () => {
    const now = Date.parse("2025-01-01T00:00:00Z");
    expect(formatExpiry("2025-01-03T00:00:00Z", now)).toBe("Welcome credits expire in 2 days");
    expect(formatExpiry("2024-12-30T00:00:00Z", now)).toBe("Welcome credits have expired");
    expect(formatExpiry(null, now)).toBeNull();
  });

  it("never offers paid next steps without balance or eligibility", () => {
    expect(affordableNextSteps(null)).toEqual(["montage"]);
    expect(affordableNextSteps(500, false)).toEqual(["montage"]);
  });
  it("scopes dismissal per user", () => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    };
    markStarterDismissed("a");
    expect(isStarterDismissed("a")).toBe(true);
    expect(isStarterDismissed("b")).toBe(false);
    expect(isStarterDismissed(null)).toBe(true);
  });
  it("detects handoffs", () => {
    expect(hasGenerateHandoff("?guide=starter&audioObjectPath=/objects/x")).toBe(true);
    expect(hasGenerateHandoff("?guide=starter&prompt=hi")).toBe(true);
    expect(hasGenerateHandoff("?guide=starter")).toBe(false);
  });
  it("respects trial eligibility", () => {
    const now = Date.parse("2025-01-05T00:00:00Z");
    expect(isAiEligible({ subscriptionStatus: "trial", trialEndsAt: "2025-01-04T00:00:00Z" }, now)).toBe(false);
    expect(isAiEligible({ subscriptionStatus: "trial", trialEndsAt: "2025-01-08T00:00:00Z" }, now)).toBe(true);
    expect(isAiEligible({ subscriptionStatus: "active" }, now)).toBe(true);
    expect(isAiEligible({ subscriptionStatus: "none" }, now)).toBe(false);
    expect(isAiEligible({ subscriptionStatus: "past_due" }, now)).toBe(false);
    expect(isAiEligible(null, now)).toBe(false);
  });
  it("lists advanced draft settings the starter would replace", () => {
    expect(advancedDraftItems({ lyrics: true, lipSync: false, reference: true, endFrame: false, sceneSources: 0, character: false }))
      .toEqual(["lyrics", "reference image"]);
  });
});
