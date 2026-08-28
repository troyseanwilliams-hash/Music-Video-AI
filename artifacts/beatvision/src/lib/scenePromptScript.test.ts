import { describe, expect, it } from "vitest";
import {
  compactGeneratedImagePromptScript,
  MAX_CREATIVE_PROMPT_LENGTH,
} from "./scenePromptScript";

describe("compact generated image prompt script", () => {
  it("uses one compact, machine-readable line per scene", () => {
    const script = compactGeneratedImagePromptScript([
      { index: 0, prompt: "  A   quiet   cabin \n beside a lake.  " },
      { index: 1, prompt: "A storm crosses the valley." },
    ]);

    expect(script).toBe("1.A quiet cabin beside a lake.\n2.A storm crosses the valley.");
    expect(script).not.toContain("\n\n");
    expect(script).not.toMatch(/[ \t]{2,}/);
    expect(script).not.toContain("…");
  });

  it("keeps a large generated script within the Creative Prompt limit", () => {
    const script = compactGeneratedImagePromptScript(
      Array.from({ length: 60 }, (_, index) => ({
        index,
        prompt: "A richly detailed cinematic scene with atmospheric lighting, layered environment, expressive action, and carefully composed visual continuity.".repeat(8),
      })),
    );

    expect(script.length).toBeLessThanOrEqual(MAX_CREATIVE_PROMPT_LENGTH);
    expect(script.split("\n")).toHaveLength(60);
    expect(script.split("\n").every((line, index) =>
      line.startsWith(`${index + 1}.`)
      && line.length > `${index + 1}.`.length
      && !line.includes("…")
      && !line.endsWith(" th")
    )).toBe(true);
  });
});