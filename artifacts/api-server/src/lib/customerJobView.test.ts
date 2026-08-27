import { describe, expect, it } from "vitest";
import { toCustomerJobView } from "./customerJobView.js";

describe("toCustomerJobView", () => {
  it("hides failed-job diagnostics and internal recovery metadata", () => {
    const source = {
      id: "job-1",
      status: "failed",
      errorMessage: "AI scene ERROR: Generation failed: the request was rejected.",
      manifest: {
        storyboard: { numClips: 30 },
        partialClips: { "0": "/objects/clips/job-1/0.mp4" },
        pendingRequests: { "19": "https://provider.example/status/private-handle" },
        uncertainSubmissions: { "20": { startedAt: 123 } },
        lipSyncPollUrl: "https://provider.example/lip-sync/private-handle",
        finalizeWithPartial: true,
        retryAfter: 456,
      },
    };

    const result = toCustomerJobView(source);

    expect(result.errorMessage).toBeNull();
    expect(result.manifest).toEqual({ storyboard: { numClips: 30 } });
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
});