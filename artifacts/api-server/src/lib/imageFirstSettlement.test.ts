import { describe, expect, it } from "vitest";
import { calculateImageFirstSettlement } from "./imageFirstSettlement.js";

const storyboard = {
  shots: [{ index: 0 }, { index: 1 }, { index: 2 }],
};

describe("image-first reservation settlement", () => {
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
});