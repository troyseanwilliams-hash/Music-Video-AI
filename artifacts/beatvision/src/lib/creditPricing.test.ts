import { describe, expect, it } from "vitest";
import {
  estimateCreditCost,
  estimateGeneratedImageCost,
  GENERATED_IMAGE_CREDITS_PER_VISUAL,
  PROVIDER_LABELS,
} from "./creditPricing";

describe("provider labels", () => {
  it("shows the directly integrated Runway model", () => {
    expect(PROVIDER_LABELS.runway).toBe("Runway Gen-4.5");
  });
});

describe("Runway credit estimates", () => {
  it("uses the direct Gen-4.5 rate with existing short- and long-video markups", () => {
    expect(estimateCreditCost("10", "runway", "720p")).toBe(160);
    expect(estimateCreditCost("60", "runway", "720p")).toBe(720);
  });
});

describe("image-first video price estimates", () => {
  it("matches the server's automatic Montage image charge", () => {
    expect(estimateGeneratedImageCost("180", null, "montage", "video")).toBe(
      18 * GENERATED_IMAGE_CREDITS_PER_VISUAL,
    );
    expect(estimateGeneratedImageCost("180", null, "montage", "generated_images")).toBe(
      18 * GENERATED_IMAGE_CREDITS_PER_VISUAL,
    );
  });

  it("matches the server's one-image-per-scene Narrative charge", () => {
    expect(estimateGeneratedImageCost("180", null, "narrative", "video")).toBe(
      18 * GENERATED_IMAGE_CREDITS_PER_VISUAL,
    );
    expect(estimateGeneratedImageCost("full", 600, "narrative", "generated_images")).toBe(
      60 * GENERATED_IMAGE_CREDITS_PER_VISUAL,
    );
  });
});