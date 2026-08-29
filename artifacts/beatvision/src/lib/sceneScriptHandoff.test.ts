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
      version: 2,
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
});