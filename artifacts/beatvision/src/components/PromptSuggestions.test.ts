import { describe, expect, it } from "vitest";
import {
  countNumberedSuggestionScenes,
  formatImageSummary,
  formatNumberedScenes,
  formatPromptSuggestion,
  PROMPT_SUGGESTIONS,
  validatePromptSuggestionLength,
  validateNumberedSuggestion,
} from "../lib/promptSuggestions";

describe("prompt suggestions", () => {
  const imageExample = PROMPT_SUGGESTIONS.image[0]!;

  it("expands an image summary to the chosen count", () => {
    const summary = formatImageSummary(imageExample, 7);
    expect(summary).toContain("exactly 7 chronological images");
    expect(summary).toContain(imageExample.summary);
  });

  it("formats image numbered scenes one per line and counts them", () => {
    const numbered = formatNumberedScenes(imageExample);
    expect(numbered.split("\n")).toHaveLength(imageExample.scenes.length);
    expect(countNumberedSuggestionScenes(numbered)).toBe(imageExample.scenes.length);
  });

  it("keeps narrative numbered scenes as chronological beats", () => {
    const narrativeExample = PROMPT_SUGGESTIONS.narrative[0]!;
    const numbered = formatPromptSuggestion(narrativeExample, "narrative", "numbered");
    expect(numbered).toContain("1.");
    expect(numbered).toContain("4.");
    expect(numbered.split("\n")).toHaveLength(4);
  });

  it("does not mutate a draft while preview formats are generated", () => {
    const draft = "My existing draft should remain untouched.";
    const preview = formatPromptSuggestion(imageExample, "image", "numbered", 4);
    expect(draft).toBe("My existing draft should remain untouched.");
    expect(preview).not.toBe(draft);
  });

  it("rejects image lists with gaps, duplicates, or more than 30 scenes", () => {
    expect(validateNumberedSuggestion("1. First\n3. Skipped")).toMatchObject({
      valid: false,
      count: 1,
    });
    expect(validateNumberedSuggestion("1. First\n1. Duplicate").valid).toBe(false);
    const thirtyOneScenes = Array.from({ length: 31 }, (_, index) => `${index + 1}. Scene ${index + 1}`).join("\n");
    expect(validateNumberedSuggestion(thirtyOneScenes)).toMatchObject({
      valid: false,
      count: 30,
    });
  });

  it("accepts exactly 30 consecutive scenes and rejects an empty list", () => {
    const thirtyScenes = Array.from({ length: 30 }, (_, index) => `${index + 1}. Scene ${index + 1}`).join("\n");
    expect(validateNumberedSuggestion(thirtyScenes)).toEqual({ valid: true, count: 30 });
    expect(validateNumberedSuggestion(" \n\t")).toMatchObject({ valid: false, count: 0 });
  });

  it("allows the prompt limit but rejects one character over it", () => {
    expect(validatePromptSuggestionLength("x".repeat(12_000))).toBeUndefined();
    expect(validatePromptSuggestionLength("x".repeat(12_001))).toContain("12,000");
  });
});