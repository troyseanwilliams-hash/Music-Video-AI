import { describe, expect, it } from "vitest";
import { getNarrationRefetchInterval, isNarrationGenerating } from "./use-narration";

describe("use-narration logic", () => {
  it("polls during active states including stitching", () => {
    expect(getNarrationRefetchInterval("queued")).toBe(2000);
    expect(getNarrationRefetchInterval("analyzing")).toBe(2000);
    expect(getNarrationRefetchInterval("generating")).toBe(2000);
    expect(getNarrationRefetchInterval("stitching")).toBe(2000);
  });

  it("stops polling on terminal states", () => {
    expect(getNarrationRefetchInterval("ready")).toBe(false);
    expect(getNarrationRefetchInterval("failed")).toBe(false);
    expect(getNarrationRefetchInterval(undefined)).toBe(false);
  });

  it("treats stitching as an active generating state for UI rendering", () => {
    expect(isNarrationGenerating("queued")).toBe(true);
    expect(isNarrationGenerating("analyzing")).toBe(true);
    expect(isNarrationGenerating("generating")).toBe(true);
    expect(isNarrationGenerating("stitching")).toBe(true);
    expect(isNarrationGenerating("ready")).toBe(false);
    expect(isNarrationGenerating("failed")).toBe(false);
    expect(isNarrationGenerating(undefined)).toBe(false);
  });
});
