import { describe, expect, it } from "vitest";
import { isDirectCheckoutLookupKey } from "./billing.js";

describe("standalone billing price allowlist", () => {
  it.each([
    "starter_monthly",
    "starter_yearly",
    "pro_monthly",
    "pro_yearly",
    "studio_monthly",
    "studio_yearly",
    "topup_250",
    "topup_1000",
    "topup_5000",
    "topup_20000",
  ])("allows standalone lookup key %s", (lookupKey) => {
    expect(isDirectCheckoutLookupKey(lookupKey)).toBe(true);
  });

  it.each([
    "suite_creator_monthly",
    "suite_creator_yearly",
    "suite_pro_monthly",
    "suite_pro_yearly",
    "suite_studio_monthly",
    "suite_studio_yearly",
  ])("rejects Suite lookup key %s", (lookupKey) => {
    expect(isDirectCheckoutLookupKey(lookupKey)).toBe(false);
  });

  it("fails closed for missing or unknown lookup keys", () => {
    expect(isDirectCheckoutLookupKey(null)).toBe(false);
    expect(isDirectCheckoutLookupKey("price_unknown")).toBe(false);
  });
});