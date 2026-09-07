import { describe, expect, it } from "vitest";
import { shouldSuppressCustomerFailureEmail } from "./renderEmail.js";

describe("customer render-failure email suppression", () => {
  it("suppresses every failure because customers receive completion notifications only", () => {
    expect(shouldSuppressCustomerFailureEmail(
      "[IMAGE_API_FAILURE]: Strict source image inspection failed at scene 12: decode failed",
    )).toBe(true);
    expect(shouldSuppressCustomerFailureEmail(
      "[IMAGE_API_FAILURE]: Strict source image inspection failed: decode failed",
    )).toBe(true);
    expect(shouldSuppressCustomerFailureEmail("The render could not be completed.")).toBe(true);
    expect(shouldSuppressCustomerFailureEmail("Provider polling timed out.")).toBe(true);
  });
});