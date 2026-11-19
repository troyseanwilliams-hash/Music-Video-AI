import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FREE_OFFER_COPY, freeOfferTerms } from "./freeOffer";

const pricingSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../pages/pricing.tsx"),
  "utf8",
);
const soundtracksSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../pages/soundtracks.tsx"),
  "utf8",
);

describe("pricing entitlement copy", () => {
  it("states the signup credits and usage caveat without claiming free songs", () => {
    expect(pricingSource).toContain("FREE_OFFER_COPY.headline");
    expect(pricingSource).toContain("FREE_OFFER_COPY.example");
    expect(pricingSource).toContain("FREE_OFFER_COPY.credits");
    expect(pricingSource).toContain("FREE_OFFER_COPY.paid");
    expect(freeOfferTerms).toContain(FREE_OFFER_COPY.credits);
    expect(freeOfferTerms).toContain(FREE_OFFER_COPY.paid);
    expect(freeOfferTerms).toContain(FREE_OFFER_COPY.example);
    expect(pricingSource).not.toMatch(/lifetime free (?:instrumentals|vocal)/i);
  });

  it("states credit requirements and the actual export allowances", () => {
    expect(pricingSource).toContain(
      "AI video, image, and narration generation uses credits",
    );
    expect(pricingSource).toContain(
      "Unlimited clean</strong> Creator Studio exports during your trial and while",
    );
    expect(pricingSource).toContain("FREE_OFFER_COPY.trialExtras");
    expect(pricingSource).toContain(
      "expired non-paid accounts get 10 free exports per calendar month, then 15 credits each",
    );
    expect(pricingSource).not.toMatch(/\b3 free (?:videos?|video exports?)\b/i);
    expect(pricingSource).not.toMatch(/\b3 free trial (?:lyric|Auto-sync)/i);
    expect(pricingSource).toContain("Trial karaoke lyric-burn exports cost credits");
  });

  it("reserves included music generations for paid instrumental subscribers only", () => {
    expect(pricingSource).toContain("Starter: 25, Pro: 100, Studio: 300 included instrumentals each month");
    expect(soundtracksSource).toContain("!withVocals && !!status?.subscriptionActive && (status.freeRemaining ?? 0) > 0");
    expect(soundtracksSource).toContain("includedInstrumental ? 0");
    expect(soundtracksSource).not.toContain("freeVocalSongsRemaining");
    expect(soundtracksSource).not.toContain("isSignupBonus");
  });
});