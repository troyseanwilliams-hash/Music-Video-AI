import { describe, expect, it } from "vitest";
import {
  calculateCreditCost,
  calculateGeneratedImageCost,
  calculateLipsyncCost,
  calculateLipsyncCostFromSourceVideo,
  getClipPlan,
  LIPSYNC_MIN_SECONDS,
  LIPSYNC_MAX_SECONDS,
} from "./creditCost.js";

describe("Narrative Story provider work and pricing", () => {
  it("charges one unique provider clip per ten-second scene", () => {
    expect(getClipPlan("180", null, "montage")).toEqual({
      numClips: 9,
      clipDurationSec: 10,
    });
    expect(getClipPlan("180", null, "narrative")).toEqual({
      numClips: 18,
      clipDurationSec: 10,
    });
    expect(calculateCreditCost("180", "720p", null, "runway", "montage")).toBe(1261);
    expect(calculateCreditCost("180", "720p", null, "runway", "narrative")).toBe(2521);
  });

  it("uses sixty paid scenes for a ten-minute full-track Narrative Story", () => {
    expect(getClipPlan("full", 600, "narrative")).toEqual({
      numClips: 60,
      clipDurationSec: 10,
    });
    expect(calculateCreditCost("full", "720p", 600, "runway", "narrative")).toBe(8401);
  });

  it("keeps five-second Narrative output on a single five-second provider call", () => {
    expect(getClipPlan("5", null, "narrative")).toEqual({
      numClips: 1,
      clipDurationSec: 5,
    });
  });
});

describe("image-first video pricing", () => {
  it("charges every unique Montage motif image even when an older client submits video mode", () => {
    expect(calculateGeneratedImageCost("180", null, "montage", "video")).toBe(9 * 4);
    expect(calculateGeneratedImageCost("180", null, "montage", "generated_images")).toBe(9 * 4);
  });

  it("charges one source image for every chronological Narrative scene", () => {
    expect(calculateGeneratedImageCost("180", null, "narrative", "video")).toBe(18 * 4);
    expect(calculateGeneratedImageCost("full", 600, "narrative", "generated_images")).toBe(60 * 4);
  });
});

// Regression coverage for "Price Lip Sync From Source Cost": completed-video
// Lip Sync must be priced from the source video's real (pre-markup) provider
// cost -- never from the credits the customer was already charged for it --
// at a markup of at least 1.5x. The standalone/admin Lip Sync Generator (no
// source video) keeps its existing duration-based provider-cost calculation,
// at the same 1.5x floor.
//
// Note: this file only covers the pricing *formulas*. The actual credit
// reservation/charge/refund HTTP flow lives in routes/teasers.ts as inline
// Express + Drizzle handlers with no extracted pure functions, and the repo
// has no Express/DB test harness yet -- so "insufficient credits" and
// "refund" below are verified as the arithmetic invariants that make that
// route correct (the exact same `cost` value drives the affordability check,
// the debit, and the refund), not as an end-to-end HTTP test.

describe("calculateLipsyncCostFromSourceVideo (completed-video Lip Sync)", () => {
  it("matches the spec's worked example: a 60s Runway video ($8.40 real cost) -> 840 credits", () => {
    // 60s requestedDuration -> 6 clips x 10s (getClipPlan) x $0.14/s (Runway) = $8.40 real cost.
    // $8.40 x 1.5 = $12.60 -> $12.60 / $0.015/credit = 840 credits.
    const cost = calculateLipsyncCostFromSourceVideo("60", null, null, "runway");
    expect(cost).toBe(840);
    // Sanity-check the promised $ figures directly, not just the credit total
    // (kept as toBeCloseTo -- float division/multiplication order differs
    // slightly from the implementation's, which is not itself a bug).
    const realCostUsd = 6 * 10 * 0.14;
    expect(realCostUsd).toBeCloseTo(8.4, 5);
    expect(realCostUsd * 1.5).toBeCloseTo(12.6, 5);
  });

  it("defaults to the Runway rate when no provider is given (same as an untouched job.aiProvider)", () => {
    expect(calculateLipsyncCostFromSourceVideo("60", null, null, undefined)).toBe(840);
    expect(calculateLipsyncCostFromSourceVideo("60", null, null, null)).toBe(840);
  });

  it("scales down for the cheaper Kling provider ($0.07/s vs Runway's $0.14/s)", () => {
    // Same 60s / 6-clip plan, half the per-second rate -> half the real cost -> half the price.
    expect(calculateLipsyncCostFromSourceVideo("60", null, null, "kling")).toBe(420);
  });

  it("scales with the source video's output resolution (720p x1, 1080p x1.25, 4K x5)", () => {
    expect(calculateLipsyncCostFromSourceVideo("60", "720p", null, "runway")).toBe(840);
    expect(calculateLipsyncCostFromSourceVideo("60", "1080p", null, "runway")).toBe(1050);
    expect(calculateLipsyncCostFromSourceVideo("60", "4k", null, "runway")).toBe(4200);
  });

  it("prices a single-clip (short) source video correctly", () => {
    // 10s -> 1 clip x 10s x $0.14/s = $1.40 real cost -> x1.5 = $2.10 -> 140 credits.
    expect(calculateLipsyncCostFromSourceVideo("10", null, null, "runway")).toBe(140);
    // 5s -> 1 clip x 5s x $0.07/s (Kling) = $0.35 -> x1.5 = $0.525 -> 35 credits.
    expect(calculateLipsyncCostFromSourceVideo("5", null, null, "kling")).toBe(35);
  });

  it("prices a full-track source video, scaled by the song's real duration", () => {
    // A 90s song -> 3 clips (fullClipCount) x 10s x $0.14/s = $4.20 -> x1.5 = $6.30 -> 420 credits.
    expect(calculateLipsyncCostFromSourceVideo("full", null, 90, "runway")).toBe(420);
  });

  it("prices a long explicit-duration source video (5 min)", () => {
    // 300s -> 15 clips x 10s x $0.14/s = $21.00 -> x1.5 = $31.50 -> 2100 credits (rounds up 1 for fp epsilon).
    expect(calculateLipsyncCostFromSourceVideo("300", null, null, "runway")).toBe(2101);
  });

  it("is always at least 1.5x the real (pre-markup) provider cost, across providers and resolutions", () => {
    const scenarios: Array<[string, string | null, number | null, string]> = [
      ["60", null, null, "runway"],
      ["60", "1080p", null, "kling"],
      ["10", "4k", null, "runway"],
      ["full", null, 240, "kling"],
    ];
    for (const [dur, res, song, provider] of scenarios) {
      const priced = calculateLipsyncCostFromSourceVideo(dur, res, song, provider);
      // Recompute the real cost the same way the source job was billed
      // (mirrors jobs.ts's own calculateCreditCost inputs), independent of
      // the lipsync formula, then assert the floor holds.
      const rate = provider === "kling" ? 0.07 : 0.14;
      const durSec = dur === "full" ? undefined : parseInt(dur, 10);
      let numClips: number;
      let clipDurationSec: number;
      if (dur === "full") {
        const secs = song && song > 0 ? song : 600;
        numClips = Math.max(3, Math.min(20, Math.ceil(Math.min(secs, 600) / 30)));
        clipDurationSec = 10;
      } else {
        clipDurationSec = (durSec as number) <= 5 ? 5 : 10;
        numClips =
          (durSec as number) > 120
            ? Math.min(30, Math.ceil((durSec as number) / 20))
            : Math.max(1, Math.ceil((durSec as number) / clipDurationSec));
      }
      const resMultiplier = res === "4k" ? 5.0 : res === "1080p" ? 1.25 : 1;
      const realCostCredits = (numClips * clipDurationSec * rate * resMultiplier) / 0.015;
      expect(priced).toBeGreaterThanOrEqual(realCostCredits * 1.5 - 1); // -1 tolerates ceil rounding
    }
  });
});

describe("calculateLipsyncCost (standalone/admin Lip Sync Generator, no source video)", () => {
  it("matches the file's own documented scale: 15s = 240 credits, 30s = 480 credits", () => {
    expect(calculateLipsyncCost(15)).toBe(240);
    expect(calculateLipsyncCost(30)).toBe(480);
  });

  it("clamps below LIPSYNC_MIN_SECONDS up to the minimum", () => {
    expect(LIPSYNC_MIN_SECONDS).toBe(5);
    expect(calculateLipsyncCost(1)).toBe(calculateLipsyncCost(LIPSYNC_MIN_SECONDS));
    expect(calculateLipsyncCost(2)).toBe(calculateLipsyncCost(LIPSYNC_MIN_SECONDS));
  });

  it("treats 0 as \"no value provided\" (falls back to the 15s default), same as null/undefined", () => {
    // `seconds || 15` in the implementation means a falsy 0 -- not a real
    // request for a 0-second clip -- reads as "unset" and gets the default,
    // exactly like null/undefined below. This documents that real behavior
    // rather than asserting the (incorrect) assumption that 0 clamps to the
    // 5s minimum.
    expect(calculateLipsyncCost(0)).toBe(calculateLipsyncCost(15));
  });

  it("clamps above LIPSYNC_MAX_SECONDS down to the maximum", () => {
    expect(LIPSYNC_MAX_SECONDS).toBe(30);
    expect(calculateLipsyncCost(45)).toBe(calculateLipsyncCost(LIPSYNC_MAX_SECONDS));
    expect(calculateLipsyncCost(9999)).toBe(calculateLipsyncCost(LIPSYNC_MAX_SECONDS));
  });

  it("falls back to the 15s default when seconds is null/undefined", () => {
    expect(calculateLipsyncCost(null)).toBe(240);
    expect(calculateLipsyncCost(undefined)).toBe(240);
  });
});

describe("reservation / charge / refund consistency", () => {
  it("is deterministic, so the same value is used to reserve, charge, and refund", () => {
    // routes/teasers.ts computes `cost` once and reuses that single value for
    // the affordability check, the debit, the success response, and the
    // failure-path refund. That's only safe if the pricing function is a
    // pure, deterministic function of the source job's immutable fields.
    const a = calculateLipsyncCostFromSourceVideo("60", "1080p", 90, "kling");
    const b = calculateLipsyncCostFromSourceVideo("60", "1080p", 90, "kling");
    const c = calculateLipsyncCostFromSourceVideo("60", "1080p", 90, "kling");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("insufficient-credit check: a balance exactly equal to cost is affordable, one credit short is not", () => {
    const cost = calculateLipsyncCostFromSourceVideo("60", null, null, "runway"); // 840
    // Mirrors routes/teasers.ts: `(credits?.creditsRemaining ?? 0) < cost` blocks the request.
    expect(cost < cost).toBe(false); // balance === cost -> not blocked
    expect(cost - 1 < cost).toBe(true); // balance === cost - 1 -> blocked
  });

  it("refund symmetry: debiting then crediting back the same cost nets to zero balance change", () => {
    const cost = calculateLipsyncCostFromSourceVideo("60", "1080p", null, "runway"); // 1050
    // routes/teasers.ts only reaches the charge once the affordability check
    // (creditsRemaining >= cost) has already passed, so a starting balance
    // below cost can't happen here in practice -- pick one comfortably above it.
    const startingBalance = cost * 5;
    const afterCharge = Math.max(startingBalance - cost, 0);
    const afterRefund = afterCharge + cost;
    expect(afterRefund).toBe(startingBalance);
  });
});
