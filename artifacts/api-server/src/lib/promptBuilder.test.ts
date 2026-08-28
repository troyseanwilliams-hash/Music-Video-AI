import { describe, expect, it } from "vitest";
import {
  buildScenePlan,
  MAX_SCENE_IMAGE_PROMPT_LENGTH,
  MAX_SCENE_SCRIPT_LENGTH,
  replaceNamedSubjectInScript,
} from "./promptBuilder.js";

describe("scene builder", () => {
  it("splits a generic story into concise numbered image prompts within the Creative Prompt limit", async () => {
    const result = await buildScenePlan({
      story: "A young inventor leaves her village. She crosses a desert during a storm. She discovers a hidden city and returns with clean energy.",
      sceneCount: 6,
    });

    expect(result.scenes).toHaveLength(6);
    expect(result.script).toMatch(/^1\. /);
    expect(result.script).toContain("\n6. ");
    expect(result.script.length).toBeLessThanOrEqual(MAX_SCENE_SCRIPT_LENGTH);
    expect(result.scenes.every((scene) =>
      scene.imagePrompt.length > 0 && scene.imagePrompt.length <= MAX_SCENE_IMAGE_PROMPT_LENGTH
    )).toBe(true);
  });

  it("refers to an attached reference image instead of inventing a character description", async () => {
    const result = await buildScenePlan({
      story: "A pilot prepares a plane, flies through a storm, and lands safely at sunrise.",
      sceneCount: 3,
      hasReferenceImage: true,
    });

    expect(result.hasReferenceImage).toBe(true);
    expect(result.scenes.every((scene) => /attached reference image/i.test(scene.imagePrompt))).toBe(true);
  });
});

describe("named subject script replacement", () => {
  it("replaces every occurrence while preserving numbered scene structure", async () => {
    const result = await replaceNamedSubjectInScript(
      "1. Amelia Earhart prepares her aircraft at dawn.\n2. Amelia Earhart takes flight over the clouds.",
      "Amelia Earhart",
    );

    expect(result.script).not.toMatch(/Amelia Earhart/i);
    expect(result.script).toContain("1.");
    expect(result.script).toContain("2.");
    expect(result.script).toContain(result.characterDescription);
    expect(result.characterDescription).toContain("aviator");
  });

  it("handles case differences in the original script", async () => {
    const result = await replaceNamedSubjectInScript(
      "A portrait of AMELIA EARHART in her flight jacket.",
      "Amelia Earhart",
    );

    expect(result.script).not.toMatch(/amelia earhart/i);
    expect(result.script).toContain("flight jacket");
  });
});