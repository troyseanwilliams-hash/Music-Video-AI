import { describe, expect, it } from "vitest";
import { toCustomerJobView } from "./customerJobView.js";

describe("toCustomerJobView", () => {
  it("replaces failed-job diagnostics with safe, actionable guidance", () => {
    const source = {
      id: "job-1",
      status: "failed",
      errorMessage: "AI scene ERROR: Generation failed: the request was rejected.",
      manifest: {
        storyboard: { numClips: 30 },
        refunded: true,
        partialClips: { "0": "/objects/clips/job-1/0.mp4" },
        pendingRequests: { "19": "https://provider.example/status/private-handle" },
        rejectedRequests: {
          "19": {
            pollUrl: "https://provider.example/status/rejected-private-handle",
            reason: "terminal provider rejection",
          },
        },
        uncertainSubmissions: { "20": { startedAt: 123 } },
        lipSyncPollUrl: "https://provider.example/lip-sync/private-handle",
        finalizeWithPartial: true,
        retryAfter: 456,
      },
    };

    const result = toCustomerJobView(source);

    expect(result.errorMessage).toBe(
      "A source image was blocked by automated safety checks. Your reserved credits were returned. Review the scene wording, remove sensitive or ambiguous details, and start a new generation.",
    );
    expect(result.manifest).toEqual({ storyboard: { numClips: 30 }, refunded: true });
    expect(source.errorMessage).toContain("request was rejected");
    expect(source.manifest.pendingRequests).toBeDefined();
  });

  it("hides active recovery notes and completed processing notices", () => {
    expect(
      toCustomerJobView({
        status: "queued",
        errorMessage: "Safely resuming saved request 19",
        manifest: {},
      }).errorMessage,
    ).toBeNull();

    expect(
      toCustomerJobView({
        status: "ready",
        errorMessage: "One optional transition was omitted after an ffmpeg error.",
        manifest: {},
      }).errorMessage,
    ).toBeNull();
  });

  it("does not expose unknown provider errors to customers", () => {
    const result = toCustomerJobView({
      status: "failed",
      errorMessage: "Provider request abc-123 failed with secret diagnostic details",
      manifest: {},
    });

    expect(result.errorMessage).toBe(
      "We couldn't complete this generation. You were not charged for unfinished work. Please start a new generation or contact support if it happens again.",
    );
    expect(result.errorMessage).not.toContain("abc-123");
  });
});