import { describe, expect, it } from "vitest";
import {
  getStoryboardSafetyDisplay,
  isSafetyRejectionCode,
  parseStoryboardSafety,
} from "./storyboardSafety";

describe("storyboard safety", () => {
  it("parses only supported metadata", () => {
    expect(parseStoryboardSafety({ status: "adjusted", reason: "  Reworded for generation. " }))
      .toEqual({ status: "adjusted", reason: "Reworded for generation." });
    expect(parseStoryboardSafety({ status: "unknown", reason: 4 })).toBeUndefined();
    expect(parseStoryboardSafety(null)).toBeUndefined();
  });

  it("treats absent metadata as requiring another check", () => {
    expect(getStoryboardSafetyDisplay(undefined)).toMatchObject({
      label: "Needs revision",
      canGenerate: false,
    });
    expect(getStoryboardSafetyDisplay({ status: "clean" })).toMatchObject({
      label: "Ready",
      canGenerate: true,
    });
  });

  it("recognizes backend safety rejection codes", () => {
    expect(isSafetyRejectionCode("PROMPT_SAFETY_REJECTED")).toBe(true);
    expect(isSafetyRejectionCode("CONTENT_SAFETY_BLOCKED")).toBe(true);
    expect(isSafetyRejectionCode("CONTENT_POLICY_VIOLATION")).toBe(true);
    expect(isSafetyRejectionCode("PROMPT_BLOCKED")).toBe(true);
    expect(isSafetyRejectionCode("INSUFFICIENT_CREDITS")).toBe(false);
  });
});