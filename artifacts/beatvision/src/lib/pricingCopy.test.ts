import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FREE_OFFER_COPY, freeOfferTerms } from "./freeOffer";

const pricingSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../pages/pricing.tsx"),
  "utf8",
);

describe("pricing entitlement copy", () => {
  it("states the trial and lifetime music grants without hiding exceptions", () => {
    expect(pricingSource).toContain("FREE_OFFER_COPY.headline");
    expect(pricingSource).toContain("FREE_OFFER_COPY.music");
    expect(pricingSource).toContain("FREE_OFFER_COPY.credits");
    expect(pricingSource).toContain("FREE_OFFER_COPY.paid");
    expect(freeOfferTerms).toContain(FREE_OFFER_COPY.credits);
    expect(freeOfferTerms).toContain(FREE_OFFER_COPY.paid);
    expect(freeOfferTerms).toContain("3 lifetime free instrumentals");
    expect(freeOfferTerms).toContain("1 lifetime free vocal song");
  });

  it("states credit requirements and the actual export allowances", () => {
    expect(pricingSource).toContain(
      "AI video, image, and narration generation uses credits",
    );
    expect(pricingSource).toContain(
      "Unlimited clean</strong> Montage Studio exports during your trial and while",
    );
    expect(pricingSource).toContain("FREE_OFFER_COPY.trialExtras");
    expect(pricingSource).toContain(
      "expired non-paid accounts get 10 free exports per calendar month, then 15 credits each",
    );
    expect(pricingSource).not.toMatch(/\b3 free (?:videos?|video exports?)\b/i);
  });
});