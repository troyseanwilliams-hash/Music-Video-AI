import { describe, expect, it } from "vitest";
import {
  resolveCharacterReferencePath,
  selectGeneratedCharacterAnchorPath,
} from "./characterAnchor.js";

const scenes = [
  { index: 0, usesCharacterReference: false },
  { index: 1, usesCharacterReference: true },
  { index: 2, usesCharacterReference: false },
  { index: 3, usesCharacterReference: true },
];

describe("generated character anchors", () => {
  it("resumes from the earliest durable character-focused asset", () => {
    expect(selectGeneratedCharacterAnchorPath([
      { assetIndex: 3, objectPath: "/objects/scene-3.png" },
      { assetIndex: 0, objectPath: "/objects/scene-0.png" },
      { assetIndex: 1, objectPath: "/objects/scene-1.png" },
    ], scenes, null)).toBe("/objects/scene-1.png");
  });

  it("does not select a generated anchor when a user reference exists", () => {
    expect(selectGeneratedCharacterAnchorPath([
      { assetIndex: 1, objectPath: "/objects/scene-1.png" },
    ], scenes, "/objects/user-reference.png")).toBeUndefined();
  });

  it("uses the anchor only for character-focused scenes", () => {
    expect(resolveCharacterReferencePath({
      usesCharacterReference: true,
      userReferenceImagePath: null,
      generatedCharacterAnchorPath: "/objects/scene-1.png",
    })).toBe("/objects/scene-1.png");
    expect(resolveCharacterReferencePath({
      usesCharacterReference: false,
      userReferenceImagePath: null,
      generatedCharacterAnchorPath: "/objects/scene-1.png",
    })).toBeUndefined();
  });

  it("always gives an uploaded reference priority", () => {
    expect(resolveCharacterReferencePath({
      usesCharacterReference: true,
      userReferenceImagePath: "/objects/user-reference.png",
      generatedCharacterAnchorPath: "/objects/generated-anchor.png",
    })).toBe("/objects/user-reference.png");
  });
});