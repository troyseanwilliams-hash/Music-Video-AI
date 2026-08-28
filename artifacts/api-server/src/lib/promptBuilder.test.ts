import { describe, expect, it } from "vitest";
import { replaceNamedSubjectInScript } from "./promptBuilder.js";

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