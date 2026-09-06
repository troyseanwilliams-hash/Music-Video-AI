import { describe, expect, it } from "vitest";
import {
  buildScenePlan,
  ensureVideoSceneDetailFirst,
  generatedPromptRespectsStoryBeat,
  MAX_SCENE_IMAGE_PROMPT_LENGTH,
  MAX_SCENE_SCRIPT_LENGTH,
  normalizeSceneBuilderScenes,
  replaceNamedSubjectInScript,
} from "./promptBuilder.js";

describe("scene builder", () => {
  it("returns one natural-language script for Narrative Story mode", async () => {
    const result = await buildScenePlan({
      story: "A shy inventor learns to trust her community while restoring a forgotten lighthouse.",
      mode: "narrative",
      sceneCount: 12,
      hasReferenceImage: true,
    });

    expect(result.mode).toBe("narrative");
    expect(result.scenes).toEqual([]);
    expect(result.sceneCount).toBe(0);
    expect(result.hasReferenceImage).toBe(false);
    expect(result.script.trim().length).toBeGreaterThan(1);
    expect(result.script).not.toMatch(/^\s*1[.):]/m);
  });

  it("splits a generic story into concise numbered image prompts within the Creative Prompt limit", async () => {
    const result = await buildScenePlan({
      story: "A young inventor leaves her village. She crosses a desert during a storm. She discovers a hidden city and returns with clean energy.",
      sceneCount: 6,
    });

    expect(result.scenes).toHaveLength(6);
    expect(result.mode).toBe("montage");
    expect(result.script).toMatch(/^1\. /);
    expect(result.script).toContain("\n6. ");
    expect(result.script.length).toBeLessThanOrEqual(MAX_SCENE_SCRIPT_LENGTH);
    expect(result.scenes.every((scene) =>
      scene.imagePrompt.length > 0 && scene.imagePrompt.length <= MAX_SCENE_IMAGE_PROMPT_LENGTH
    )).toBe(true);
  });

  it("uses an attached character reference only in relevant scenes", async () => {
    const result = await buildScenePlan({
      story: "A pilot prepares a plane. An empty hangar waits in the rain. Sunrise fills the distant skyline.",
      sceneCount: 3,
      hasReferenceImage: true,
    });

    expect(result.hasReferenceImage).toBe(true);
    expect(result.scenes[0]!.imagePrompt).toMatch(/attached reference image/i);
    expect(result.scenes[1]!.imagePrompt).not.toMatch(/attached reference image/i);
    expect(result.scenes[2]!.imagePrompt).not.toMatch(/attached reference image/i);
  });

  it("removes a named subject from character-reference scene prompts", async () => {
    const result = await buildScenePlan({
      story: "Amelia Earhart prepares her aircraft. Amelia Earhart takes flight. The empty runway waits at dusk.",
      sceneCount: 3,
      hasReferenceImage: true,
    });

    expect(result.scenes[0]!.imagePrompt).toMatch(/attached reference image/i);
    expect(result.scenes[0]!.imagePrompt).not.toMatch(/Amelia Earhart/i);
    expect(result.scenes[1]!.imagePrompt).not.toMatch(/Amelia Earhart/i);
    expect(result.scenes[2]!.imagePrompt).not.toMatch(/attached reference image/i);
  });

  it("uses descriptive text for a named subject when there is no reference", async () => {
    const result = await buildScenePlan({
      story: "Amelia Earhart prepares her aircraft. Amelia Earhart takes flight. The empty runway waits at dusk.",
      sceneCount: 3,
      hasReferenceImage: false,
    });

    expect(result.scenes[0]!.imagePrompt).not.toMatch(/Amelia Earhart/i);
    expect(result.scenes[0]!.imagePrompt).toMatch(/woman aviator/i);
    expect(result.scenes.every((scene) =>
      !/attached reference image/i.test(scene.imagePrompt)
    )).toBe(true);
  });

  it("rejects model prompts that introduce alternate character roles", () => {
    expect(generatedPromptRespectsStoryBeat(
      "A woman pilot checks the aircraft controls.",
      "A male navigator checks the aircraft controls under warm cockpit light.",
    )).toBe(false);
    expect(generatedPromptRespectsStoryBeat(
      "The woman pilot and male navigator study charts.",
      "The woman aviator and male navigator study charts under amber light.",
    )).toBe(true);
  });

  it("keeps environment-only beats free of model-invented characters", () => {
    const result = normalizeSceneBuilderScenes(
      [
        {
          title: "Empty hangar",
          imagePrompt: "A lone mechanic crosses the empty hangar under dramatic blue light.",
        },
      ],
      "An empty hangar waits in the rain.",
      1,
      false,
    );

    expect(result[0]!.imagePrompt).toContain("An empty hangar waits in the rain");
    expect(result[0]!.imagePrompt).not.toMatch(/\bmechanic\b/i);
  });

  it("falls back to the source beat when a model changes the character", () => {
    const result = normalizeSceneBuilderScenes(
      [
        {
          title: "Cockpit check",
          imagePrompt: "A male navigator checks the aircraft controls in a tense cockpit.",
        },
      ],
      "A woman pilot checks the aircraft controls.",
      1,
      false,
    );

    expect(result[0]!.imagePrompt).toContain("A woman pilot checks the aircraft controls");
    expect(result[0]!.imagePrompt).not.toMatch(/\bmale navigator\b/i);
  });
});

describe("video prompt ordering", () => {
  it("puts concrete scene detail before style and camera language", () => {
    const description = "A woman races across a flooded train platform";
    const prompt = ensureVideoSceneDetailFirst(
      description,
      "Cinematic 35mm style, dramatic blue lighting, handheld camera as she runs.",
    );

    expect(prompt.startsWith(description)).toBe(true);
    expect(prompt.indexOf("flooded train platform")).toBeLessThan(
      prompt.indexOf("Cinematic 35mm style"),
    );
  });

  it("does not duplicate scene detail already placed first", () => {
    const description = "A lighthouse beam sweeps across the storm";
    const prompt = ensureVideoSceneDetailFirst(
      description,
      `${description}. Moody color grade and slow aerial movement.`,
    );

    expect(prompt.match(/lighthouse beam/gi)).toHaveLength(1);
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