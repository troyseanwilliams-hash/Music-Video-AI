import { describe, expect, it } from "vitest";
import {
  calculateImageFirstSettlement,
  imageFirstAutomaticRetryCost,
  imageFirstRetryReservation,
} from "./imageFirstSettlement.js";

const storyboard = {
  shots: [{ index: 0 }, { index: 1 }, { index: 2 }],
};

describe("image-first reservation settlement", () => {
  it("does not charge again when retained images failed before any video request", () => {
    expect(imageFirstAutomaticRetryCost({
      imageFirstVersion: 1,
      reservedCredits: 1637,
      imageReview: { phase: "approved" },
    })).toBe(0);
  });

  it("requires a new reservation after video provider work has started", () => {
    expect(imageFirstAutomaticRetryCost({
      imageFirstVersion: 1,
      reservedCredits: 1637,
      imageReview: { phase: "approved" },
      pendingRequests: { 0: { pollUrl: "accepted" } },
    })).toBe(1637);
  });

  it("keeps completed source images charged and refunds unfinished work", () => {
    expect(calculateImageFirstSettlement({
      imageFirstVersion: 1,
      reservedCredits: 300,
      reservedSubscriptionCredits: 200,
      reservedTopupCredits: 100,
      imageCreditCost: 21,
      videoCreditCost: 279,
      storyboard,
    }, 2)).toEqual({
      chargedCredits: 14,
      refundedCredits: 286,
      subscriptionRefund: 186,
      topupRefund: 100,
      completedImages: 2,
      spentVideoScenes: 0,
    });
  });

  it("charges each confirmed video scene only once across recovery maps", () => {
    const amounts = calculateImageFirstSettlement({
      imageFirstVersion: 1,
      reservedCredits: 300,
      reservedSubscriptionCredits: 300,
      reservedTopupCredits: 0,
      imageCreditCost: 21,
      videoCreditCost: 279,
      storyboard,
      partialClips: { 0: "/objects/clip-0.mp4" },
      pendingRequests: { 0: { pollUrl: "saved" }, 1: { pollUrl: "saved" } },
      rejectedRequests: { 1: { reason: "failed" } },
      uncertainSubmissions: { 7: { reason: "out of range" } },
    }, 3);

    expect(amounts.spentVideoScenes).toBe(2);
    expect(amounts.chargedCredits).toBe(207);
    expect(amounts.refundedCredits).toBe(93);
  });

  it("gives uploaded subscription credits back before top-up credits", () => {
    const amounts = calculateImageFirstSettlement({
      imageFirstVersion: 1,
      reservedCredits: 300,
      reservedSubscriptionCredits: 10,
      reservedTopupCredits: 290,
      imageCreditCost: 21,
      videoCreditCost: 279,
      storyboard,
    }, 2);

    expect(amounts.chargedCredits).toBe(14);
    expect(amounts.subscriptionRefund).toBe(0);
    expect(amounts.topupRefund).toBe(286);
  });

  it("never charges reused gallery images as newly generated work", () => {
    const amounts = calculateImageFirstSettlement({
      imageFirstVersion: 1,
      reservedCredits: 107,
      reservedSubscriptionCredits: 107,
      reservedTopupCredits: 0,
      imageCreditCost: 7,
      videoCreditCost: 100,
      reusedSourceImageCount: 2,
      storyboard,
    }, 2);

    expect(amounts.completedImages).toBe(2);
    expect(amounts.chargedCredits).toBe(0);
    expect(amounts.refundedCredits).toBe(107);
  });

  it("keeps an accepted but unresolved source-image request charged", () => {
    const amounts = calculateImageFirstSettlement({
      imageFirstVersion: 1,
      reservedCredits: 100,
      reservedSubscriptionCredits: 100,
      reservedTopupCredits: 0,
      imageCreditCost: 14,
      videoCreditCost: 86,
      pendingImageRequests: { "1": { pollUrl: "saved" } },
      storyboard,
    }, 1);

    expect(amounts.chargedCredits).toBe(7);
    expect(amounts.refundedCredits).toBe(93);
  });

  it("does not charge a free replacement as a newly generated image", () => {
    const amounts = calculateImageFirstSettlement({
      imageFirstVersion: 1,
      reservedCredits: 100,
      reservedSubscriptionCredits: 100,
      reservedTopupCredits: 0,
      imageCreditCost: 14,
      videoCreditCost: 86,
      narrativeImages: {},
      storyboard,
    }, 1);

    expect(amounts.chargedCredits).toBe(0);
    expect(amounts.refundedCredits).toBe(100);
  });

  it("does not charge retained images again after a refunded job is resumed", () => {
    const amounts = calculateImageFirstSettlement({
      imageFirstVersion: 1,
      reservedCredits: 279,
      reservedSubscriptionCredits: 0,
      reservedTopupCredits: 279,
      imageCreditCost: 0,
      videoCreditCost: 279,
      narrativeImages: {
        0: "/objects/retained-0.jpg",
        1: "/objects/retained-1.jpg",
        2: "/objects/retained-2.jpg",
      },
      storyboard,
      partialClips: { 0: "/objects/resumed-clip-0.mp4" },
    }, 3);

    expect(amounts.completedImages).toBe(3);
    expect(amounts.spentVideoScenes).toBe(1);
    expect(amounts.chargedCredits).toBe(93);
    expect(amounts.refundedCredits).toBe(186);
    expect(amounts.subscriptionRefund).toBe(0);
    expect(amounts.topupRefund).toBe(186);
  });

  it("reserves only the portion returned by a partial image-first settlement", () => {
    expect(imageFirstRetryReservation({
      imageFirstVersion: 1,
      refunded: true,
      reservedCredits: 7462,
      imageFirstRefundedCredits: 6475,
    })).toBe(6475);
  });

  it("settles a second failure against only the resumed reservation", () => {
    const amounts = calculateImageFirstSettlement({
      imageFirstVersion: 1,
      reservedCredits: 300,
      reservedSubscriptionCredits: 10,
      reservedTopupCredits: 190,
      imageCreditCost: 21,
      videoCreditCost: 279,
      imageFirstChargedCredits: 100,
      narrativeImages: {
        0: "/objects/retained-0.jpg",
        1: "/objects/retained-1.jpg",
        2: "/objects/retained-2.jpg",
      },
      storyboard,
      partialClips: {
        0: "/objects/resumed-clip-0.mp4",
        1: "/objects/resumed-clip-1.mp4",
      },
    }, 3);

    expect(amounts.chargedCredits).toBe(207);
    expect(amounts.refundedCredits).toBe(93);
    expect(amounts.subscriptionRefund).toBe(0);
    expect(amounts.topupRefund).toBe(93);
  });
});