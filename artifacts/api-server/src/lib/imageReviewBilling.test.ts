import { describe, expect, it } from "vitest";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "./creditCost.js";
import {
  imageReviewReplacementCredits,
  isOwnedUploadObjectPath,
} from "./imageReviewBilling.js";

describe("image review replacement billing", () => {
  it("charges a new image when recovering a failed generation that was not charged", () => {
    expect(imageReviewReplacementCredits({
      source: "original_generation",
      status: "failed",
    })).toBe(GENERATED_IMAGE_CREDITS_PER_VISUAL);
  });

  it("charges a new generation when replacing a ready image", () => {
    expect(imageReviewReplacementCredits({
      source: "original_generation",
      status: "ready",
    })).toBe(GENERATED_IMAGE_CREDITS_PER_VISUAL);
    expect(imageReviewReplacementCredits({
      source: "regenerated",
      status: "ready",
    })).toBe(GENERATED_IMAGE_CREDITS_PER_VISUAL);
  });

  it("does not charge again when replacing a stored image that became unreadable", () => {
    expect(imageReviewReplacementCredits({
      source: "original_generation",
      status: "failed",
      errorMessage: "This stored image could not be read. Replace it before approving the storyboard.",
    })).toBe(0);
  });
});

describe("image review upload ownership", () => {
  it("accepts an object in the authenticated user's upload namespace", () => {
    expect(isOwnedUploadObjectPath(
      "/objects/uploads/user-123/0c1d2e3f-4567-489a-bcde-0123456789ab.png",
      "user-123",
    )).toBe(true);
  });

  it("rejects another user's private object path", () => {
    expect(isOwnedUploadObjectPath(
      "/objects/uploads/other-user/0c1d2e3f-4567-489a-bcde-0123456789ab.png",
      "user-123",
    )).toBe(false);
  });

  it("rejects empty, nested, and traversal-like upload paths", () => {
    expect(isOwnedUploadObjectPath("/objects/uploads/user-123/", "user-123")).toBe(false);
    expect(isOwnedUploadObjectPath(
      "/objects/uploads/user-123/nested/image.png",
      "user-123",
    )).toBe(false);
    expect(isOwnedUploadObjectPath(
      "/objects/uploads/user-123/../other-user/image.png",
      "user-123",
    )).toBe(false);
  });
});