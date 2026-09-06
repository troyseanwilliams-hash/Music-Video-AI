import { describe, expect, it } from "vitest";
import { getNarrationRefetchInterval, isNarrationGenerating } from "./use-narration";
import { narrationCost, narrationMusicSurcharge } from "../../../api-server/src/lib/narration";

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

describe("narration cost", () => {
  it("does not add a separate ElevenLabs music surcharge", () => {
    const baseCost = narrationCost(100, "none"); // e.g. 3
    expect(narrationMusicSurcharge("generated")).toBe(0);
    expect(narrationCost(100, "generated")).toBe(baseCost);
    expect(narrationCost(100, "soundtrack")).toBe(baseCost);
    expect(narrationCost(100, "upload")).toBe(baseCost);
    expect(narrationCost(100, "suno")).toBe(baseCost);
  });
});

describe("Narration payload logic", () => {
  function isSelectionComplete(musicSource: string, soundtrackId?: string, musicObjectPath?: string) {
    if (musicSource === "soundtrack" && !soundtrackId) return false;
    if (["upload", "suno"].includes(musicSource) && !musicObjectPath) return false;
    return true;
  }

  it("requires proper assets before allowing estimation or submission", () => {
    expect(isSelectionComplete("none")).toBe(true);
    expect(isSelectionComplete("generated")).toBe(true);

    expect(isSelectionComplete("soundtrack")).toBe(false);
    expect(isSelectionComplete("soundtrack", "st-123", "/objects/st-123")).toBe(true);

    expect(isSelectionComplete("upload")).toBe(false);
    expect(isSelectionComplete("upload", undefined, "/objects/upload/abc")).toBe(true);

    expect(isSelectionComplete("suno")).toBe(false);
    expect(isSelectionComplete("suno", undefined, "/objects/audio/suno-123")).toBe(true);
  });
});
