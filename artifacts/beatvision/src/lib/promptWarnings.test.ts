import { describe, expect, it } from "vitest";
import { detectNamedSubject } from "./promptWarnings";

describe("detectNamedSubject", () => {
  it("detects a known person in a visual prompt", () => {
    expect(detectNamedSubject("A realistic portrait of Amelia Earhart in 1930s flight gear"))
      .toBe("Amelia Earhart");
  });

  it("detects a named fictional character in context", () => {
    expect(detectNamedSubject("Show Harry Potter standing in a candlelit library"))
      .toBe("Harry Potter");
  });

  it("does not warn for an ordinary visual description", () => {
    expect(detectNamedSubject("A determined pilot in a brown leather jacket beside a silver aircraft"))
      .toBeNull();
  });
});