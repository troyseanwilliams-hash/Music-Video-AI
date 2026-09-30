import { describe, expect, it } from "vitest";
import { DAILY_CONTENT } from "./dailyContent";
import { FREE_OFFER, FREE_OFFER_COPY, freeOfferTerms } from "./freeOffer";

describe("account credits registration offer", () => {
  it("keeps limits and caveats together for offer consumers", () => {
    expect(FREE_OFFER).toMatchObject({
      trialDays: 7, startingGenerationCredits: 150, trialLyricExports: 0, trialAutoSyncs: 0,
      postTrialMonthlyMontageExports: 10, postTrialMontageOverageCredits: 15,
    });
    expect(FREE_OFFER_COPY.short).toBe("Get 150 free credits when you create your account.");
    expect(FREE_OFFER_COPY.example).toBe("Enough for about 21 images, or 1 video clip plus several images. Actual usage varies by model and settings.");
    expect(FREE_OFFER_COPY.expiry).toBe("Unused welcome credits expire when your 7-day trial ends.");
    expect(FREE_OFFER_COPY.trialExtras).toContain("Karaoke lyric-burn exports and Auto-sync aligns use credits");
    for (const copy of [FREE_OFFER_COPY.short, FREE_OFFER_COPY.example, FREE_OFFER_COPY.expiry, FREE_OFFER_COPY.videoExample, FREE_OFFER_COPY.music, FREE_OFFER_COPY.trialExtras,
      FREE_OFFER_COPY.afterTrial, FREE_OFFER_COPY.credits, FREE_OFFER_COPY.paid]) {
      expect(freeOfferTerms).toContain(copy);
    }
    expect(DAILY_CONTENT.some((item) => item.text === FREE_OFFER_COPY.short)).toBe(true);
  });
});