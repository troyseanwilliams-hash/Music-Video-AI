import { describe, expect, it } from "vitest";
import { shortenCompletePrompt } from "./promptText.js";

describe("shortenCompletePrompt", () => {
  it("prefers a complete sentence when the next sentence would exceed the limit", () => {
    expect(
      shortenCompletePrompt(
        "A lantern glows beside the quiet harbor. A storm gathers beyond the dark horizon.",
        42,
      ),
    ).toBe("A lantern glows beside the quiet harbor.");
  });

  it("ends at a whole word with sentence punctuation instead of an ellipsis", () => {
    const shortened = shortenCompletePrompt(
      "The character walks through the ancient city under moonlight.",
      28,
    );

    expect(shortened).toBe("The character walks through.");
    expect(shortened).not.toContain("…");
    expect(shortened).not.toMatch(/[A-Za-z]…$/);
  });
});