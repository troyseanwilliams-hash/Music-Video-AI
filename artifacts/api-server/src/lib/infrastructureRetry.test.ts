import { describe, expect, it } from "vitest";
import {
  INFRASTRUCTURE_RETRY,
  MAX_NO_CHARGE_POLL_RECOVERIES,
  canResumeFailedSavedOutputRecovery,
  isTransientInfrastructureError,
  planNoChargePollRecovery,
  recoverableInfrastructureError,
  savedOutputsCoverEveryScene,
} from "./infrastructureRetry.js";

describe("infrastructure retry classification", () => {
  it.each([
    new Error("Connection terminated unexpectedly"),
    new Error("Connection terminated due to connection timeout"),
    new Error('Failed query: update "jobs" set "progress_percent" = GREATEST(progress_percent, $1)'),
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

  it("uses a separate bounded counter for no-charge provider polling recovery", () => {
    expect(planNoChargePollRecovery({}, false)).toEqual({
      countKey: "providerPollRecoveryCount",
      nextCount: 1,
      canRetry: true,
    });
    expect(planNoChargePollRecovery({
      providerPollRecoveryCount: MAX_NO_CHARGE_POLL_RECOVERIES - 1,
    }, false).canRetry).toBe(true);
    expect(planNoChargePollRecovery({
      providerPollRecoveryCount: MAX_NO_CHARGE_POLL_RECOVERIES,
    }, false).canRetry).toBe(false);
  });

  it("keeps image polling recovery separate and fails closed on malformed counters", () => {
    expect(planNoChargePollRecovery({
      providerPollRecoveryCount: MAX_NO_CHARGE_POLL_RECOVERIES,
      imagePollRecoveryCount: 2,
    }, true)).toEqual({
      countKey: "imagePollRecoveryCount",
      nextCount: 3,
      canRetry: true,
    });
    expect(planNoChargePollRecovery({
      providerPollRecoveryCount: -5,
    }, false)).toEqual({
      countKey: "providerPollRecoveryCount",
      nextCount: MAX_NO_CHARGE_POLL_RECOVERIES + 1,
      canRetry: false,
    });
  });

  it("allows saved-output-only recovery without inspecting unrelated source images", () => {
    const persisted = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => index)
        .filter((index) => index !== 11)
        .map((index) => [String(index), `/objects/clips/job/example/${index}.mp4`]),
    );
    expect(savedOutputsCoverEveryScene(15, persisted, {
      11: "https://provider.example/requests/scene-12",
    })).toBe(true);
    expect(savedOutputsCoverEveryScene(15, persisted, {})).toBe(false);
    expect(savedOutputsCoverEveryScene(15, persisted, {
      11: "not-a-valid-poll-url",
    })).toBe(false);
    expect(canResumeFailedSavedOutputRecovery(15, {
      partialClips: persisted,
      pendingRequests: { 11: "https://provider.example/requests/scene-12" },
    })).toBe(true);
    expect(canResumeFailedSavedOutputRecovery(15, {
      partialClips: persisted,
      pendingRequests: { 11: "https://provider.example/requests/scene-12" },
      submissionIntents: { 11: { provider: "saved" } },
    })).toBe(false);
    expect(canResumeFailedSavedOutputRecovery(15, {
      partialClips: persisted,
      pendingRequests: {
        11: "https://provider.example/requests/scene-12",
        15: "https://provider.example/requests/out-of-range",
      },
    })).toBe(false);
  });
});