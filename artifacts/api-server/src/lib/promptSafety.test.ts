import { describe, expect, it } from "vitest";
import { sanitizeGeneratedMediaPrompt } from "./promptSafety.js";

describe("sanitizeGeneratedMediaPrompt", () => {
  it("rewrites risky child-contact language while preserving the scene", () => {
    const result = sanitizeGeneratedMediaPrompt(
      "scene direction: scene direction: A tiny robot rolls across a rug to play with a curious baby, then nuzzles the baby’s hand.",
    );

    expect(result.changed).toBe(true);
    expect(result.reasons).toContain("minor-contact");
    expect(result.prompt).toContain("A tiny robot rolls across a rug");
    expect(result.prompt).toContain("supervising parent");
    expect(result.prompt).toMatch(/^Family-friendly non-contact composition/);
    expect(result.prompt).not.toMatch(/nuzzles|play with a curious baby|scene direction: scene direction:/i);
  });

  it("softens explicit, graphic, and self-harm language", () => {
    const result = sanitizeGeneratedMediaPrompt(
      "A naked figure surrounded by gore considers suicide.",
    );

    expect(result.reasons).toEqual(expect.arrayContaining([
      "adult-content",
      "graphic-violence",
      "self-harm",
    ]));
    expect(result.prompt).not.toMatch(/\bnaked\b|\bgore\b|\bsuicide\b/i);
  });

  it("leaves safe prompts unchanged", () => {
    const prompt = "A silver robot watches sunrise from a quiet hill, cinematic wide shot.";
    expect(sanitizeGeneratedMediaPrompt(prompt)).toEqual({
      prompt,
      changed: false,
      reasons: [],
    });
  });

  it("is stable when applied more than once", () => {
    const once = sanitizeGeneratedMediaPrompt("A robot nuzzles the baby’s hand.").prompt;
    expect(sanitizeGeneratedMediaPrompt(once).prompt).toBe(once);
  });
});