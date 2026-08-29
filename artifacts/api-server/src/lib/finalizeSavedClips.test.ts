import { describe, expect, it } from "vitest";
import { hasCompleteSavedClipSet } from "./finalizeSavedClips.js";

describe("hasCompleteSavedClipSet", () => {
  it("accepts a complete zero-based saved scene set", () => {
    expect(
      hasCompleteSavedClipSet(
        {
          "0": "/objects/clips/job-1/0.mp4",
          "1": "/objects/clips/job-1/1.mp4",
          "2": "/objects/clips/job-1/2.mp4",
        },
        3,
      ),
    ).toBe(true);
  });

  it("rejects a saved scene set with a required slot missing", () => {
    expect(
      hasCompleteSavedClipSet(
        {
          "0": "/objects/clips/job-1/0.mp4",
          "2": "/objects/clips/job-1/2.mp4",
        },
        3,
      ),
    ).toBe(false);
  });

  it("does not let an extra out-of-range clip hide a missing slot", () => {
    expect(
      hasCompleteSavedClipSet(
        {
          "0": "/objects/clips/job-1/0.mp4",
          "1": "/objects/clips/job-1/1.mp4",
          "3": "/objects/clips/job-1/3.mp4",
        },
        3,
      ),
    ).toBe(false);
  });
});