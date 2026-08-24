import { describe, expect, it } from "vitest";
import {
  IMAGE_REMIX_KIND,
  isValidImageRemixHandoff,
  type ImageRemixHandoff,
} from "./imageRemixHandoff";

const handoff: ImageRemixHandoff = {
  kind: IMAGE_REMIX_KIND,
  images: [{
    objectPath: "/objects/image-packs/job-1/0.jpg",
    prompt: "A lone traveler on a foggy road",
    assetIndex: 0,
  }],
};

describe("isValidImageRemixHandoff", () => {
  it("accepts a selected generated-image handoff", () => {
    expect(isValidImageRemixHandoff(handoff)).toBe(true);
  });

  it("rejects empty or malformed selections", () => {
    expect(isValidImageRemixHandoff({ kind: IMAGE_REMIX_KIND, images: [] })).toBe(false);
    expect(isValidImageRemixHandoff({ kind: IMAGE_REMIX_KIND, images: [{ assetIndex: 0 }] })).toBe(false);
  });

  it("rejects assets outside app storage", () => {
    expect(isValidImageRemixHandoff({
      ...handoff,
      images: [{ ...handoff.images[0]!, objectPath: "https://example.com/image.jpg" }],
    })).toBe(false);
  });
});