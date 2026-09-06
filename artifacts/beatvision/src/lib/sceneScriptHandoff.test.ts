import { describe, expect, it } from "vitest";
import {
  consumeSceneScriptHandoff,
  MAX_SCENE_SCRIPT_HANDOFF_LENGTH,
  saveSceneScriptHandoff,
} from "./sceneScriptHandoff";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("scene script handoff", () => {
  it("moves a valid script into Generate exactly once", () => {
    const storage = memoryStorage();
    expect(saveSceneScriptHandoff("1. First image\n2. Second image", storage)).toBe(true);
    expect(consumeSceneScriptHandoff(storage)).toEqual({
      version: 3,
      mode: "montage",
      script: "1. First image\n2. Second image",
    });
    expect(consumeSceneScriptHandoff(storage)).toBeNull();
  });

  it("rejects scripts that cannot fit the Creative Prompt field", () => {
    const storage = memoryStorage();
    expect(saveSceneScriptHandoff("x".repeat(MAX_SCENE_SCRIPT_HANDOFF_LENGTH + 1), storage)).toBe(false);
    expect(consumeSceneScriptHandoff(storage)).toBeNull();
  });

  it("preserves the exact edited script and selected music planning context", () => {
    const storage = memoryStorage();
    expect(saveSceneScriptHandoff({
      mode: "narrative",
      script: "1. Edited opening\n2. Edited finale",
      originalStory: "An inventor crosses a desert and returns home.",
      audio: {
        title: "Desert Dawn",
        objectPath: "/objects/audio/user-1/desert-dawn.mp3",
        durationSeconds: 124.5,
      },
      planner: {
        fingerprint: "planner-fingerprint",
        settings: { style: "cinematic", requestedDuration: "full" },
      },
    }, storage)).toBe(true);
    expect(consumeSceneScriptHandoff(storage)).toEqual({
      version: 3,
      mode: "narrative",
      script: "1. Edited opening\n2. Edited finale",
      originalStory: "An inventor crosses a desert and returns home.",
      audio: {
        title: "Desert Dawn",
        objectPath: "/objects/audio/user-1/desert-dawn.mp3",
        durationSeconds: 124.5,
      },
      planner: {
        fingerprint: "planner-fingerprint",
        settings: { style: "cinematic", requestedDuration: "full" },
      },
    });
  });

  it("consumes version 2 handoffs for backward compatibility", () => {
    const storage = memoryStorage();
    storage.setItem("beatvision:scene-script-handoff", JSON.stringify({
      version: 2,
      mode: "montage",
      script: "1. Existing scene",
    }));
    expect(consumeSceneScriptHandoff(storage)).toEqual({
      version: 3,
      mode: "montage",
      script: "1. Existing scene",
    });
  });
});