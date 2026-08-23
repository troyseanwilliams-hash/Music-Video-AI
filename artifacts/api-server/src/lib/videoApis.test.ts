import { afterEach, describe, expect, it, vi } from "vitest";
import { generateClip, resolveClipProviderChain } from "./videoApis.js";

describe("resolveClipProviderChain", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("routes a selected Runway render through the normal production provider chain", () => {
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    vi.stubEnv("PIXAZO_RUNWAY_MODEL", "test-runway-model");
    vi.stubEnv("LUMA_API_KEY", "");
    vi.stubEnv("VIDEO_API", "");
    vi.stubEnv("VIDEO_API_CHAIN", "");

    expect(resolveClipProviderChain({ provider: "runway" })).toEqual([
      "runway",
      "kling",
      "pixazo",
    ]);
  });

  it("honors provider-only requests without enabling an unrelated fallback", () => {
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    vi.stubEnv("PIXAZO_RUNWAY_MODEL", "test-runway-model");

    expect(
      resolveClipProviderChain({ provider: "runway", providerOnly: true }),
    ).toEqual(["runway"]);
  });

  it("submits Runway through Pixazo's Gen-4.5 endpoint", async () => {
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    vi.stubEnv("PIXAZO_RUNWAY_MODEL", "runway-gen-4-5");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            request_id: "runway-request-123",
            polling_url: "https://gateway.pixazo.ai/v2/requests/status/runway-request-123",
          }),
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "COMPLETED",
            output: { media_url: ["https://cdn.example.com/runway.mp4"] },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateClip({
        prompt: "cinematic rain",
        durationSeconds: 10,
        aspectRatio: "16:9",
        resolution: "720p",
        provider: "runway",
        providerOnly: true,
      }),
    ).resolves.toEqual({
      videoUrl: "https://cdn.example.com/runway.mp4",
      provider: "runway",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://gateway.pixazo.ai/runway-gen-4-5/v1/gen-4.5/text-to-video",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: "cinematic rain" }),
      }),
    );
  }, 10_000);

  it("fails a provider-only request instead of silently using another engine", async () => {
    vi.stubEnv("PIXAZO_API_KEY", "");
    vi.stubEnv("PIXAZO_RUNWAY_MODEL", "");
    vi.stubEnv("LUMA_API_KEY", "test-luma-key");
    vi.stubEnv("VIDEO_API_CHAIN", "luma");

    expect(
      resolveClipProviderChain({ provider: "runway", providerOnly: true }),
    ).toEqual([]);
    await expect(
      generateClip({
        prompt: "cinematic rain",
        durationSeconds: 5,
        provider: "runway",
        providerOnly: true,
      }),
    ).rejects.toThrow("selected AI video engine is unavailable");
  });

  it("records a 5xx submission as uncertain before failing the clip", async () => {
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    const onUncertainSubmission = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            statusCode: 500,
            message: "Internal server error",
            activityId: "activity-123",
          }),
          { status: 500 },
        ),
      ),
    );

    await expect(
      generateClip({
        prompt: "cinematic rain",
        durationSeconds: 5,
        provider: "kling",
        providerOnly: true,
        onUncertainSubmission,
      }),
    ).rejects.toThrow("AI service 500");
    expect(onUncertainSubmission).toHaveBeenCalledWith({
      provider: "kling",
      status: 500,
      activityId: "activity-123",
      reason: "AI service returned HTTP 500",
    });
  });

  it("records a malformed success response as uncertain", async () => {
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    const onUncertainSubmission = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>upstream error</html>", { status: 200 }),
      ),
    );

    await expect(
      generateClip({
        prompt: "cinematic rain",
        durationSeconds: 5,
        provider: "kling",
        providerOnly: true,
        onUncertainSubmission,
      }),
    ).rejects.toThrow("response could not be verified");
    expect(onUncertainSubmission).toHaveBeenCalledWith({
      provider: "kling",
      status: 200,
      reason: "AI service returned an unreadable success response",
    });
  });

  it("records a null success response as uncertain", async () => {
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    const onUncertainSubmission = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("null", { status: 200 })),
    );

    await expect(
      generateClip({
        prompt: "cinematic rain",
        durationSeconds: 5,
        provider: "kling",
        providerOnly: true,
        onUncertainSubmission,
      }),
    ).rejects.toThrow("response could not be verified");
    expect(onUncertainSubmission).toHaveBeenCalledWith({
      provider: "kling",
      status: 200,
      reason: "AI service returned an invalid success response",
    });
  });
});