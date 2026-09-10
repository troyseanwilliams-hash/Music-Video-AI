import { describe, expect, it } from "vitest";
import {
  assessGeneratedMediaPrompt,
  sanitizeGeneratedMediaPrompt,
} from "./promptSafety.js";

describe("sanitizeGeneratedMediaPrompt", () => {
  it("rewrites risky child-contact language while preserving the scene", () => {
    const result = sanitizeGeneratedMediaPrompt(
      "scene direction: scene direction: A tiny robot rolls across a rug to play with a curious baby, then nuzzles the baby’s hand.",
    );

    expect(result.changed).toBe(true);
    expect(result.reasons).toContain("minor-contact");
    expect(result.prompt).toContain("A tiny robot rolls across a rug");
    expect(result.prompt).toContain("parent");
    expect(result.prompt).toMatch(/^Wholesome supervised family scene/);
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

  it.each([
    ["A person on fire crosses the stage.", "warm-light aura"],
    ["An explosion in her face reveals the chorus.", "confetti"],
    ["He gives an obsessive stare before fainting.", "focused gaze"],
    ["A cracked glass screen shows a ghost dissolving into mist.", "mosaic-light"],
    ["His denim jacket wreathes in harmless cartoon flames.", "warm-light patterns"],
    ["A heart balloon popping in the man's surprised face.", "confetti"],
    ["A disco ball made from a cracked phone screen.", "mosaic-light"],
  ])("deterministically softens benign provider-risky wording: %s", (input, expected) => {
    const first = sanitizeGeneratedMediaPrompt(input);
    expect(first.changed).toBe(true);
    expect(first.prompt).toContain(expected);
    expect(sanitizeGeneratedMediaPrompt(first.prompt).prompt).toBe(first.prompt);
  });
});

describe("assessGeneratedMediaPrompt", () => {
  it("returns UI-ready clean and adjusted assessments", () => {
    expect(assessGeneratedMediaPrompt("A calm sunrise.")).toMatchObject({
      status: "clean",
      safePrompt: "A calm sunrise.",
      reason: null,
    });
    expect(assessGeneratedMediaPrompt("A person in flames dances.")).toMatchObject({
      status: "adjusted",
      reason: expect.stringContaining("adjusted"),
    });
  });

  it.each([
    "Explicit pornography in a hotel room.",
    "A person slits their wrists.",
    "A child in sexual content.",
    "A severed limb with blood spraying.",
  ])("blocks residual prohibited content without returning it as a safe prompt", (input) => {
    expect(assessGeneratedMediaPrompt(input)).toMatchObject({
      status: "blocked",
      safePrompt: "",
      reason: expect.any(String),
    });
  });
});