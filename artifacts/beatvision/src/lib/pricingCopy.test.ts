import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pricingSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../pages/pricing.tsx"),
  "utf8",
);

describe("pricing entitlement copy", () => {
  it("states the trial and lifetime music grants without hiding exceptions", () => {
    expect(pricingSource).toContain(
      "7-day trial with zero starting credits, excluding valid referral or promotional grants",
    );
    expect(pricingSource).toContain("3 lifetime free instrumentals");
    expect(pricingSource).toContain("1 lifetime free vocal song");
  });

  it("states credit requirements and the actual export allowances", () => {
    expect(pricingSource).toContain(
      "AI video, image, and narration generation uses credits",
    );
    expect(pricingSource).toContain(
      "Unlimited clean</strong> Montage Studio exports during your trial and while",
    );
    expect(pricingSource).toContain(
      "3 free trial lyric-burn exports, then the lyric add-on charge; 3 free trial Auto-sync",
    );
    expect(pricingSource).toContain(
      "expired non-paid accounts get 10 free exports per calendar month, then 15 credits each",
    );
    expect(pricingSource).not.toMatch(/\b3 free (?:videos?|video exports?)\b/i);
  });
});