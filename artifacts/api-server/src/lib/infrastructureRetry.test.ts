import { describe, expect, it } from "vitest";
import {
  INFRASTRUCTURE_RETRY,
  isTransientInfrastructureError,
  recoverableInfrastructureError,
} from "./infrastructureRetry.js";

describe("infrastructure retry classification", () => {
  it.each([
    new Error("Connection terminated unexpectedly"),
    new Error("Connection terminated due to connection timeout"),
    new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
  ])("recognizes transient infrastructure failures", (error) => {
    expect(isTransientInfrastructureError(error)).toBe(true);
    expect(recoverableInfrastructureError(error).message).toContain(INFRASTRUCTURE_RETRY);
  });

  it.each([
    new Error("[IMAGE_API_FAILURE] request was rejected"),
    new Error("content policy violation"),
    new Error("invalid image format"),
  ])("does not reclassify permanent media failures", (error) => {
    expect(isTransientInfrastructureError(error)).toBe(false);
  });

  it("checks nested causes from database wrappers", () => {
    const error = new Error("Failed query", {
      cause: new Error("Connection terminated unexpectedly"),
    });
    expect(isTransientInfrastructureError(error)).toBe(true);
  });
});