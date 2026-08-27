import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateClip,
  pollPixazoRequestUntilComplete,
  PROVIDER_API_FAILURE,
  PROVIDER_TERMINAL_FAILURE,
  PROVIDER_POLL_TIMEOUT,
  resolveClipProviderChain,
} from "./videoApis.js";

describe("resolveClipProviderChain", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("routes a selected Runway render through the normal production provider chain", () => {
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    vi.stubEnv("RUNWAY_API_KEY", "runway-key");
    vi.stubEnv("LUMA_API_KEY", "");
    vi.stubEnv("VIDEO_API", "");
    vi.stubEnv("VIDEO_API_CHAIN", "");

    expect(resolveClipProviderChain({ provider: "runway" })).toEqual([
      "runway",
      "kling",
    ]);
  });

  it("honors provider-only requests without enabling an unrelated fallback", () => {
    vi.stubEnv("RUNWAY_API_KEY", "runway-key");

    expect(
      resolveClipProviderChain({ provider: "runway", providerOnly: true }),
    ).toEqual(["runway"]);
  });

  it("adds the explicitly authorized terminal fallback to a provider-only request", () => {
    vi.stubEnv("PIXAZO_API_KEY", "test-key");

    expect(
      resolveClipProviderChain({
        provider: "runway",
        providerOnly: true,
        terminalFallbackProvider: "kling",
      }),
    ).toEqual(["runway", "kling"]);
  });

  it("submits the fallback only after the primary request is terminal", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    vi.stubEnv("RUNWAY_API_KEY", "runway-key");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onTerminalFallback = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "runway-terminal",
      }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "FAILED",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        request_id: "kling-fallback",
        polling_url: "https://gateway.pixazo.ai/v2/requests/status/kling-fallback",
      }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "COMPLETED",
        output: { media_url: ["https://cdn.example.com/kling-fallback.mp4"] },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = generateClip({
      prompt: "cinematic rain",
      durationSeconds: 5,
      provider: "runway",
      providerOnly: true,
      terminalFallbackProvider: "kling",
      onSubmit,
      onTerminalFallback,
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual({
      videoUrl: "https://cdn.example.com/kling-fallback.mp4",
      provider: "kling",
    });
    expect(onTerminalFallback).toHaveBeenCalledWith({
      fromProvider: "runway",
      toProvider: "kling",
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("submits Runway directly through its documented Gen-4.5 endpoint", async () => {
    vi.stubEnv("RUNWAY_API_KEY", "runway-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "runway-request-123",
          }),
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "SUCCEEDED",
            output: ["https://cdn.example.com/runway.mp4"],
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
      "https://api.dev.runwayml.com/v1/text_to_video",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer runway-key",
          "X-Runway-Version": "2024-11-06",
        }),
        body: JSON.stringify({
          model: "gen4.5",
          promptText: "cinematic rain",
          ratio: "1280:720",
          duration: 10,
        }),
      }),
    );
  }, 10_000);

  it("fails a provider-only request instead of silently using another engine", async () => {
    vi.stubEnv("RUNWAY_API_KEY", "");
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
    const onTerminalFallback = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 500,
          message: "Internal server error",
          activityId: "activity-123",
        }),
        { status: 500 },
      ),
    );
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );

    await expect(
      generateClip({
        prompt: "cinematic rain",
        durationSeconds: 5,
        provider: "kling",
        providerOnly: true,
        terminalFallbackProvider: "runway",
        onUncertainSubmission,
        onTerminalFallback,
      }),
    ).rejects.toThrow("temporarily unavailable");
    expect(onUncertainSubmission).toHaveBeenCalledWith({
      provider: "kling",
      status: 500,
      activityId: "activity-123",
      reason: "AI service returned HTTP 500",
    });
    expect(onTerminalFallback).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never falls back to Kling after an ambiguous direct Runway submission", async () => {
    vi.stubEnv("RUNWAY_API_KEY", "runway-key");
    vi.stubEnv("PIXAZO_API_KEY", "pixazo-key");
    vi.stubEnv("VIDEO_API_CHAIN", "runway,kling");
    const onUncertainSubmission = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("upstream unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateClip({
        prompt: "cinematic rain",
        durationSeconds: 5,
        provider: "runway",
        onUncertainSubmission,
      }),
    ).rejects.toThrow("temporarily unavailable");

    expect(onUncertainSubmission).toHaveBeenCalledWith({
      provider: "runway",
      status: 503,
      reason: "AI service returned HTTP 503",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.dev.runwayml.com/v1/text_to_video",
    );
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

  it("marks an exhausted persisted scene request as a resumable polling timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RUNWAY_API_KEY", "runway-key");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "runway-timeout-123",
          }),
          { status: 202 },
        ),
      )
      .mockImplementation(
        async () => new Response(JSON.stringify({ status: "RUNNING" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = generateClip({
      prompt: "cinematic rain",
      durationSeconds: 10,
      provider: "runway",
      providerOnly: true,
      onSubmit,
    });
    const assertion = expect(result).rejects.toThrow(PROVIDER_POLL_TIMEOUT);
    await vi.advanceTimersByTimeAsync(180 * 5_000);

    await assertion;
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(181);
  });

  it("continues polling a saved scene request without a second provider submission", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    const pollUrl = "https://gateway.pixazo.ai/v2/requests/status/saved-request";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: "COMPLETED",
        output: { media_url: ["https://cdn.example.com/recovered.mp4"] },
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = pollPixazoRequestUntilComplete(pollUrl);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBe("https://cdn.example.com/recovered.mp4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(pollUrl);
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("method");
  });

  it("keeps an explicitly rejected saved scene request terminal", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("expired", { status: 404 })));

    const result = pollPixazoRequestUntilComplete("https://gateway.pixazo.ai/v2/requests/status/missing");
    const assertion = expect(result).rejects.toThrow(PROVIDER_TERMINAL_FAILURE);
    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
  });

  it("preserves a saved request through authentication failures", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = pollPixazoRequestUntilComplete(
      "https://gateway.pixazo.ai/v2/requests/status/auth-failure",
    );
    const assertion = expect(result).rejects.toThrow(PROVIDER_POLL_TIMEOUT);
    await vi.advanceTimersByTimeAsync(180 * 5_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(180);
  });
});