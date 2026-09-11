import { describe, expect, it } from "vitest";
import {
  isCurrentImagePackPlanRequest,
  isImagePackPlanValid,
  updateImagePackScenePrompt,
} from "./imagePackReview";

describe("image-pack review state", () => {
  const plannedScenes = [
    { index: 0, prompt: "Scene one" },
    { index: 1, prompt: "Scene two" },
    { index: 2, prompt: "Scene three" },
  ];

  it("accepts an ordered non-empty plan and preserves edits", () => {
    expect(isImagePackPlanValid(plannedScenes, 3)).toBe(true);

    const edited = updateImagePackScenePrompt(plannedScenes, 1, "Edited scene two");
    expect(edited).toEqual([
      plannedScenes[0],
      { index: 1, prompt: "Edited scene two" },
      plannedScenes[2],
    ]);
    expect(isImagePackPlanValid(edited, 3)).toBe(true);
  });

  it("rejects empty, duplicate, overlong, or reordered scenes before charging", () => {
    expect(isImagePackPlanValid([
      plannedScenes[0],
      { index: 1, prompt: " " },
      plannedScenes[2],
    ], 3)).toBe(false);
    expect(isImagePackPlanValid([
      { index: 0, prompt: "same" },
      { index: 1, prompt: " SAME " },
      plannedScenes[2],
    ], 3)).toBe(false);
    expect(isImagePackPlanValid([
      { index: 0, prompt: "x".repeat(1001) },
      plannedScenes[1],
      plannedScenes[2],
    ], 3)).toBe(false);
    expect(isImagePackPlanValid([
      { index: 1, prompt: "Scene one" },
      { index: 0, prompt: "Scene two" },
      plannedScenes[2],
    ], 3)).toBe(false);
  });

  it("ignores stale responses after a newer review or dialog close", () => {
    expect(isCurrentImagePackPlanRequest(2, 2, true, true)).toBe(true);
    expect(isCurrentImagePackPlanRequest(1, 2, true, true)).toBe(false);
    expect(isCurrentImagePackPlanRequest(2, 2, false, true)).toBe(false);
    expect(isCurrentImagePackPlanRequest(2, 2, true, false)).toBe(false);
  });
});