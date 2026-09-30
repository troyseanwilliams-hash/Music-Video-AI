import { describe, expect, it } from "vitest";
import { DAILY_CONTENT } from "./dailyContent";
import { FREE_OFFER, FREE_OFFER_COPY, freeOfferTerms } from "./freeOffer";

describe("free Montage registration offer", () => {
  it("keeps limits and caveats together for offer consumers", () => {
    expect(FREE_OFFER).toMatchObject({
      trialDays: 7, startingGenerationCredits: 0, lifetimeInstrumentals: 3,
      lifetimeVocalSongs: 1, trialLyricExports: 3, trialAutoSyncs: 3,
      postTrialMonthlyMontageExports: 10, postTrialMontageOverageCredits: 15,
      referralSignupBonusCredits: 50,
    });
    for (const copy of [FREE_OFFER_COPY.short, FREE_OFFER_COPY.music, FREE_OFFER_COPY.trialExtras,
      FREE_OFFER_COPY.afterTrial, FREE_OFFER_COPY.credits, FREE_OFFER_COPY.paid]) {
      expect(freeOfferTerms).toContain(copy);
    }
    expect(DAILY_CONTENT.some((item) => item.text === FREE_OFFER_COPY.short)).toBe(true);
  });
});