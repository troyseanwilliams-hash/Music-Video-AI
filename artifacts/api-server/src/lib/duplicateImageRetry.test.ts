import { describe, expect, it } from "vitest";
import {
  hasDuplicateImageFailure,
  prepareDuplicateImageRetry,
} from "./duplicateImageRetry.js";

const scenes = Object.fromEntries(
  Array.from({ length: 4 }, (_, index) => [
    String(index),
    {
      index,
      canonicalPath: `/objects/scene-${index}.jpg`,
      revision: 1,
      source: "original_generation" as const,
      prompt: `Scene ${index + 1} original requirement`,
      status: "ready" as const,
    },
  ]),
);

describe("duplicate image retry", () => {
  it("queues a free automatic replacement for the later duplicate", () => {
    const prepared = prepareDuplicateImageRetry({
      refunded: true,
      imageFirstVersion: 1,
      imageFirstRefundedCredits: 1225,
      imageReview: {
        phase: "approved",
        revision: 1,
        approvedRevision: 1,
        scenes,
      },
    }, "Strict job contains duplicate source image content at positions 2 and 4", {
      replacementId: "replacement-1",
      createdAt: "2026-08-30T22:00:00.000Z",
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.replacementIndex).toBe(3);
    expect(prepared?.duplicateOfIndex).toBe(1);
    expect(prepared?.resumeCredits).toBe(1225);
    expect(prepared?.nextReview.phase).toBe("awaiting_approval");
    expect(prepared?.nextReview.approvedRevision).toBeUndefined();
    expect(prepared?.nextReview.scenes["1"]?.status).toBe("ready");
    expect(prepared?.nextReview.scenes["3"]?.status).toBe("pending");
    expect(prepared?.nextReview.pendingReplacements?.["replacement-1"]).toMatchObject({
      index: 3,
      credits: 0,
      subscriptionCredits: 0,
      topupCredits: 0,
      status: "queued",
    });
    expect(
      prepared?.nextReview.pendingReplacements?.["replacement-1"]?.prompt,
    ).toContain("create a clearly different image from scene 2");
  });

  it("does not prepare a retry without a settled refundable reservation", () => {
    expect(prepareDuplicateImageRetry({
      refunded: false,
      imageFirstVersion: 1,
      imageFirstRefundedCredits: 1225,
      imageReview: {
        phase: "approved",
        revision: 1,
        approvedRevision: 1,
        scenes,
      },
    }, "duplicate source image content at positions 2 and 4")).toBeNull();
  });

  it("recognizes the customer-safe duplicate failure with settlement text", () => {
    expect(hasDuplicateImageFailure(
      "Strict job contains duplicate source image content at positions 2 and 4 Credits for unfinished work were returned.",
    )).toBe(true);
  });
});