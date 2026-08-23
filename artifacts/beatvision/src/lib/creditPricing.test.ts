import { describe, expect, it } from "vitest";
import { estimateGeneratedImageCost } from "./creditPricing";

describe("image-first video price estimates", () => {
  it("matches the server's automatic Montage image charge", () => {
    expect(estimateGeneratedImageCost("180", null, "montage", "video")).toBe(9 * 4);
    expect(estimateGeneratedImageCost("180", null, "montage", "generated_images")).toBe(9 * 4);
  });

  it("matches the server's one-image-per-scene Narrative charge", () => {
    expect(estimateGeneratedImageCost("180", null, "narrative", "video")).toBe(18 * 4);
    expect(estimateGeneratedImageCost("full", 600, "narrative", "generated_images")).toBe(60 * 4);
  });
});