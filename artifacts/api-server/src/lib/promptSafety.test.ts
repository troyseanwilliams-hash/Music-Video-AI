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

  it("removes legacy identity-lock wording from reference-image prompts", () => {
    const legacy = "A man crosses a dream ocean, use the same exact character shown in the attached reference image as the single canonical identity; preserve its gender presentation, identity, face, hair, age, wardrobe, and distinguishing physical details; do not invent, substitute, or redesign the character, cinematic lighting.";
    const result = sanitizeGeneratedMediaPrompt(legacy);

    expect(result.changed).toBe(true);
    expect(result.reasons).toContain("reference-identity-instruction");
    expect(result.prompt).toContain("match the principal character to the attached reference image");
    expect(result.prompt).not.toMatch(/canonical identity|preserve its gender|distinguishing physical details|do not invent|substitute|redesign/i);
    expect(sanitizeGeneratedMediaPrompt(result.prompt).prompt).toBe(result.prompt);
  });

  it.each([
    "A detective enters a bright lobby, match the principal character to the attached reference image; preserve its gender presentation, identity, face, hair, age, wardrobe, and distinguishing. Visual style: cinematic 35mm film.",
    "A detective enters a bright lobby, match the principal character to the attached reference image; do not invent, substitute, or redesign the. Visual style: cinematic 35mm film.",
    "A detective enters a bright lobby, use the same exact character shown in the attached reference image as the single canonical. Visual style: cinematic 35mm film.",
    "A detective enters a bright lobby, keep the same exact character shown in the attached reference image across all referenced scenes, including the. Visual style: cinematic 35mm film.",
  ])("removes a whole-word-truncated legacy identity directive: %s", (legacy) => {
    const result = sanitizeGeneratedMediaPrompt(legacy);
    expect(result.prompt).toContain("A detective enters a bright lobby");
    expect(result.prompt).toContain("Visual style: cinematic 35mm film");
    expect(result.prompt).not.toMatch(/canonical|preserve its gender|do not invent|same exact character/i);
    expect(sanitizeGeneratedMediaPrompt(result.prompt).prompt).toBe(result.prompt);
  });

  const legacyDirectiveFamilies = [
    { separator: ", ", directive: "use the same exact character shown in the attached reference image as the single canonical identity" },
    { separator: "; ", directive: "preserve its gender presentation identity face hair age wardrobe and distinguishing physical details" },
    { separator: "; ", directive: "do not invent substitute or redesign the character" },
    { separator: ", ", directive: "keep the same exact character shown in the attached reference image across all referenced scenes including the characters gender presentation" },
  ];

  it("removes every whole-word truncation of each legacy reference directive", () => {
    for (const { separator, directive } of legacyDirectiveFamilies) {
      const words = directive.split(" ");
      for (let length = 1; length <= words.length; length++) {
        const truncated = words.slice(0, length).join(" ");
        const input = `A detective enters a bright lobby${separator}${truncated}. Visual style: cinematic 35mm film.`;
        const result = sanitizeGeneratedMediaPrompt(input);
        expect(result.prompt, `${directive} truncated after word ${length}`)
          .toBe("A detective enters a bright lobby. Visual style: cinematic 35mm film.");
        expect(sanitizeGeneratedMediaPrompt(result.prompt).prompt).toBe(result.prompt);
      }
    }
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