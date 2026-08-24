import { describe, expect, it } from "vitest";
import { shouldShowVideoScenePreviews } from "./jobStatusDisplay";

describe("shouldShowVideoScenePreviews", () => {
  it("never shows the video storyboard for Images-only jobs", () => {
    expect(shouldShowVideoScenePreviews("image_pack", "generating", 10)).toBe(false);
    expect(shouldShowVideoScenePreviews("image_pack", "stitching", 10)).toBe(false);
  });

  it("keeps live scene previews for video generation jobs", () => {
    expect(shouldShowVideoScenePreviews("ai_video", "generating", 10)).toBe(true);
    expect(shouldShowVideoScenePreviews("ai", "stitching", 10)).toBe(true);
  });

  it("hides the grid outside active video preview stages", () => {
    expect(shouldShowVideoScenePreviews("ai_video", "ready", 10)).toBe(false);
    expect(shouldShowVideoScenePreviews("ai_video", "generating", 0)).toBe(false);
  });
});