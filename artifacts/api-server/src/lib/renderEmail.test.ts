import { describe, expect, it } from "vitest";
import { shouldSuppressCustomerFailureEmail } from "./renderEmail.js";

describe("customer render-failure email suppression", () => {
  it("suppresses unreadable retained-image failures until recovery finishes", () => {
    expect(shouldSuppressCustomerFailureEmail(
      "[IMAGE_API_FAILURE]: Strict source image inspection failed at scene 12: decode failed",
    )).toBe(true);
    expect(shouldSuppressCustomerFailureEmail(
      "[IMAGE_API_FAILURE]: Strict source image inspection failed: decode failed",
    )).toBe(true);
  });

  it("does not suppress unrelated permanent failures", () => {
    expect(shouldSuppressCustomerFailureEmail("The render could not be completed.")).toBe(false);
  });
});