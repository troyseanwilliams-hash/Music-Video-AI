import { describe, expect, it } from "vitest";
import {
  canResumeDuplicateClipJob,
  hasDuplicateClipFailure,
} from "./duplicateClipRetry.js";

describe("duplicate clip retry", () => {
  const meta = {
    strictUniqueSourcesVersion: 1,
    refunded: true,
    imageFirstRefundedCredits: 0,
    partialClips: { 0: "clip-0", 1: "clip-1", 2: "clip-2" },
    storyboard: { numClips: 3 },
  };

  it("recognizes a legacy duplicate-clip failure for saved-clip recovery", () => {
    expect(hasDuplicateClipFailure(
      ": Strict job contains duplicate generated clip content at positions 1 and 2",
    )).toBe(true);
    expect(canResumeDuplicateClipJob(
      meta,
      ": Strict job contains duplicate generated clip content at positions 1 and 2",
    )).toBe(true);
  });

  it("refuses recovery when money was actually returned", () => {
    expect(canResumeDuplicateClipJob(
      { ...meta, imageFirstRefundedCredits: 100 },
      "duplicate generated clip content at positions 1 and 2",
    )).toBe(false);
  });

  it("refuses recovery when a saved clip is missing", () => {
    expect(canResumeDuplicateClipJob(
      { ...meta, partialClips: { 0: "clip-0", 2: "clip-2" } },
      "duplicate generated clip content at positions 1 and 2",
    )).toBe(false);
  });
});