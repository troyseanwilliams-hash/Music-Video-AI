import { describe, expect, it } from "vitest";
import {
  HYBRID_REMIX_KIND,
  buildHybridTimeline,
  hybridTimelineDurationSec,
  isDurationMismatched,
  isValidHybridHandoff,
  type HybridRemixHandoff,
} from "./hybridRemixHandoff.js";

// Regression coverage for the "Guided Hybrid Lip Sync Remix" timeline math
// and handoff validation -- the part of the feature that's pure and
// dependency-free, so it can be tested without React, fetch, or a DOM. See
// LipSyncPanel.tsx (builds + validates the handoff) and editor.tsx (consumes
// it) for the parts that DO need those and aren't covered here.

function baseHandoff(overrides: Partial<HybridRemixHandoff> = {}): HybridRemixHandoff {
  return {
    kind: HYBRID_REMIX_KIND,
    originalVideoId: "video-1",
    originalObjectPath: "/objects/original.mp4",
    originalThumbnailPath: "/objects/original-thumb.jpg",
    originalDurationSec: 180,
    lipsyncVideoId: "video-2",
    lipsyncObjectPath: "/objects/lipsync.mp4",
    lipsyncThumbnailPath: "/objects/lipsync-thumb.jpg",
    lipsyncStartTime: 30,
    lipsyncDurationSec: 15,
    songObjectPath: "/objects/song.mp3",
    songDurationSec: 180,
    ...overrides,
  };
}

describe("buildHybridTimeline", () => {
  it("builds three segments (before/lipsync/after) for a range in the middle of the song", () => {
    const result = buildHybridTimeline(baseHandoff({ lipsyncStartTime: 30, lipsyncDurationSec: 15, originalDurationSec: 180 }));
    expect(result.segments.map((s) => s.label)).toEqual(["before", "lipsync", "after"]);

    const [before, lipsync, after] = result.segments;
    expect(before).toMatchObject({ objectPath: "/objects/original.mp4", durationSec: 30, trimStart: 0, trimEnd: 150 });
    expect(lipsync).toMatchObject({ objectPath: "/objects/lipsync.mp4", durationSec: 15, trimStart: 0, trimEnd: 0 });
    expect(after).toMatchObject({ objectPath: "/objects/original.mp4", durationSec: 135, trimStart: 45, trimEnd: 0 });

    expect(result.musicObjectPath).toBe("/objects/song.mp3");
    expect(result.musicDurationSec).toBe(180);
  });

  it("omits the \"before\" segment when the range starts at 0:00 (start-of-song)", () => {
    const result = buildHybridTimeline(baseHandoff({ lipsyncStartTime: 0, lipsyncDurationSec: 15, originalDurationSec: 180 }));
    expect(result.segments.map((s) => s.label)).toEqual(["lipsync", "after"]);
    expect(result.segments[0]).toMatchObject({ durationSec: 15, trimStart: 0, trimEnd: 0 });
    expect(result.segments[1]).toMatchObject({ durationSec: 165, trimStart: 15, trimEnd: 0 });
  });

  it("omits the \"after\" segment when the range runs to the very end (end-of-song)", () => {
    const result = buildHybridTimeline(baseHandoff({ lipsyncStartTime: 165, lipsyncDurationSec: 15, originalDurationSec: 180 }));
    expect(result.segments.map((s) => s.label)).toEqual(["before", "lipsync"]);
    expect(result.segments[0]).toMatchObject({ durationSec: 165, trimStart: 0, trimEnd: 15 });
    expect(result.segments[1]).toMatchObject({ durationSec: 15, trimStart: 0, trimEnd: 0 });
  });

  it("produces just the lipsync segment when the range covers the entire video", () => {
    const result = buildHybridTimeline(baseHandoff({ lipsyncStartTime: 0, lipsyncDurationSec: 180, originalDurationSec: 180 }));
    expect(result.segments.map((s) => s.label)).toEqual(["lipsync"]);
    expect(result.segments[0]!.durationSec).toBe(180);
  });

  it("clamps an out-of-range start (negative) to 0 instead of producing a negative-duration segment", () => {
    const result = buildHybridTimeline(baseHandoff({ lipsyncStartTime: -10, lipsyncDurationSec: 15, originalDurationSec: 180 }));
    expect(result.segments.every((s) => s.durationSec >= 0)).toBe(true);
    expect(result.segments[0]!.label).toBe("lipsync"); // clamped start -> 0, so no "before" segment
  });

  it("clamps a range that would run past the end of the video instead of producing a negative \"after\" segment", () => {
    const result = buildHybridTimeline(baseHandoff({ lipsyncStartTime: 170, lipsyncDurationSec: 30, originalDurationSec: 180 }));
    expect(result.segments.every((s) => s.durationSec >= 0)).toBe(true);
    expect(result.segments.map((s) => s.label)).toEqual(["before", "lipsync"]);
    expect(hybridTimelineDurationSec(result)).toBe(180);
  });

  it("clamps a start point entirely past the video's end to a safe, non-crashing (if degenerate) timeline", () => {
    const result = buildHybridTimeline(baseHandoff({ lipsyncStartTime: 500, lipsyncDurationSec: 15, originalDurationSec: 180 }));
    expect(result.segments.every((s) => s.durationSec >= 0)).toBe(true);
    // Both start and end clamp to 180, so the lipsync slice is empty (omitted) and only "before" (the whole video) remains.
    expect(result.segments.map((s) => s.label)).toEqual(["before"]);
    expect(hybridTimelineDurationSec(result)).toBe(180);
  });
});

describe("hybridTimelineDurationSec (duration preservation)", () => {
  it("always sums to exactly the original video's duration, regardless of where the range falls", () => {
    const cases = [
      { lipsyncStartTime: 30, lipsyncDurationSec: 15, originalDurationSec: 180 },
      { lipsyncStartTime: 0, lipsyncDurationSec: 15, originalDurationSec: 180 },
      { lipsyncStartTime: 165, lipsyncDurationSec: 15, originalDurationSec: 180 },
      { lipsyncStartTime: 0, lipsyncDurationSec: 180, originalDurationSec: 180 },
      { lipsyncStartTime: 12.5, lipsyncDurationSec: 22.25, originalDurationSec: 97.4 },
    ];
    for (const c of cases) {
      const result = buildHybridTimeline(baseHandoff(c));
      expect(hybridTimelineDurationSec(result)).toBeCloseTo(c.originalDurationSec, 5);
    }
  });
});

describe("isDurationMismatched", () => {
  it("is false when the song and video durations agree within tolerance", () => {
    expect(isDurationMismatched(180, 180)).toBe(false);
    expect(isDurationMismatched(180, 178.5)).toBe(false); // within the 2s tolerance
  });

  it("is true when they disagree beyond tolerance", () => {
    expect(isDurationMismatched(180, 170)).toBe(true);
    expect(isDurationMismatched(180, 190)).toBe(true);
  });

  it("is false (not \"mismatched\") when the song duration is unknown -- that's the separate \"unavailable\" case", () => {
    expect(isDurationMismatched(180, null)).toBe(false);
  });
});

describe("isValidHybridHandoff (failed-handoff safety net)", () => {
  it("accepts a well-formed handoff", () => {
    expect(isValidHybridHandoff(baseHandoff())).toBe(true);
  });

  it("accepts null for the optional thumbnail/song-duration fields", () => {
    expect(
      isValidHybridHandoff(baseHandoff({ originalThumbnailPath: null, lipsyncThumbnailPath: null, songDurationSec: null })),
    ).toBe(true);
  });

  it("rejects non-objects and null", () => {
    expect(isValidHybridHandoff(null)).toBe(false);
    expect(isValidHybridHandoff(undefined)).toBe(false);
    expect(isValidHybridHandoff("hybrid_lipsync")).toBe(false);
    expect(isValidHybridHandoff(42)).toBe(false);
  });

  it("rejects a missing or wrong \"kind\" (e.g. the older simple {video, videoId} handoff shape)", () => {
    expect(isValidHybridHandoff({ video: { objectPath: "/objects/x.mp4" }, videoId: "v1" })).toBe(false);
    expect(isValidHybridHandoff({ ...baseHandoff(), kind: "something_else" })).toBe(false);
  });

  it("rejects a payload missing a required field", () => {
    const { originalObjectPath: _drop, ...missingField } = baseHandoff();
    expect(isValidHybridHandoff(missingField)).toBe(false);
  });

  it("rejects an empty-string object path", () => {
    expect(isValidHybridHandoff(baseHandoff({ originalObjectPath: "" }))).toBe(false);
  });

  it("rejects a non-positive originalDurationSec or lipsyncDurationSec", () => {
    expect(isValidHybridHandoff(baseHandoff({ originalDurationSec: 0 }))).toBe(false);
    expect(isValidHybridHandoff(baseHandoff({ originalDurationSec: -5 }))).toBe(false);
    expect(isValidHybridHandoff(baseHandoff({ lipsyncDurationSec: 0 }))).toBe(false);
  });

  it("rejects a negative lipsyncStartTime", () => {
    expect(isValidHybridHandoff(baseHandoff({ lipsyncStartTime: -1 }))).toBe(false);
  });

  it("rejects non-finite numeric fields (NaN/Infinity from a corrupted payload)", () => {
    expect(isValidHybridHandoff(baseHandoff({ originalDurationSec: NaN }))).toBe(false);
    expect(isValidHybridHandoff(baseHandoff({ lipsyncStartTime: Infinity }))).toBe(false);
  });
});
