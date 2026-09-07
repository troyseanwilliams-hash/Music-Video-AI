import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadClip,
  generateClip,
  pollPixazoRequestUntilComplete,
  PROVIDER_API_FAILURE,
  PROVIDER_MEDIA_TERMINAL,
  PROVIDER_POLL_ABORTED,
  PROVIDER_SUBMISSION_UNCERTAIN,
  PROVIDER_TERMINAL_FAILURE,
  PROVIDER_POLL_TIMEOUT,
  klingDirectAvailable,
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

  it("keeps direct Kling unavailable unless its exact opt-in and both credentials are present", () => {
    vi.stubEnv("KLING_DIRECT_ENABLED", "true");
    vi.stubEnv("KLING_DIRECT_ACCESS_KEY", "access");
    vi.stubEnv("KLING_DIRECT_SECRET_KEY", "");
    expect(klingDirectAvailable()).toBe(false);
    expect(resolveClipProviderChain({ provider: "kling_direct", providerOnly: true })).toEqual([]);

    vi.stubEnv("KLING_DIRECT_SECRET_KEY", "secret");
    expect(klingDirectAvailable()).toBe(true);
    expect(resolveClipProviderChain({ provider: "kling_direct", providerOnly: true })).toEqual(["kling_direct"]);
  });

  it("submits and polls a direct Kling task without changing gateway Kling", async () => {
    vi.useFakeTimers();
    vi.stubEnv("KLING_DIRECT_ENABLED", "true");
    vi.stubEnv("KLING_DIRECT_ACCESS_KEY", "access");
    vi.stubEnv("KLING_DIRECT_SECRET_KEY", "secret");
    vi.stubEnv("KLING_DIRECT_API_BASE", "https://kling.test");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { id: "task-1", status: "submitted" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: [{ id: "task-1", status: "succeeded", outputs: [{ type: "video", url: "https://cdn.example.com/direct.mp4" }] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = generateClip({ prompt: "cinematic rain", durationSeconds: 5, imageUrl: "https://img.example.com/frame.jpg", provider: "kling_direct", providerOnly: true, onSubmit });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual({ videoUrl: "https://cdn.example.com/direct.mp4", provider: "kling_direct" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://kling.test/image-to-video/kling-3.0");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({
      contents: [
        { type: "prompt", text: "cinematic rain" },
        { type: "first_frame", url: "https://img.example.com/frame.jpg" },
      ],
      settings: {
        resolution: "720p",
        duration: 5,
        audio: "off",
        multi_shot: false,
      },
      options: {
        watermark_info: { enabled: false },
      },
    });
    expect(onSubmit).toHaveBeenCalledWith({ provider: "kling_direct", requestId: "task-1", pollUrl: "https://kling.test/tasks?task_ids=task-1" });
    expect(fetchMock.mock.calls[1]?.[1].headers.Authorization).toMatch(/^Bearer /);
  });

  it("records a direct Kling 5xx submission as uncertain and does not fall back", async () => {
    vi.stubEnv("KLING_DIRECT_ENABLED", "true");
    vi.stubEnv("KLING_DIRECT_ACCESS_KEY", "access");
    vi.stubEnv("KLING_DIRECT_SECRET_KEY", "secret");
    const onUncertainSubmission = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("busy", { status: 503 })));
    await expect(generateClip({ prompt: "rain", durationSeconds: 5, provider: "kling_direct", providerOnly: true, onUncertainSubmission })).rejects.toThrow(PROVIDER_SUBMISSION_UNCERTAIN);
    expect(onUncertainSubmission).toHaveBeenCalledWith({ provider: "kling_direct", status: 503, reason: "AI service returned HTTP 503" });
  });

  it("keeps a failed direct Kling task terminal", async () => {
    vi.useFakeTimers();
    vi.stubEnv("KLING_DIRECT_ENABLED", "true");
    vi.stubEnv("KLING_DIRECT_ACCESS_KEY", "access");
    vi.stubEnv("KLING_DIRECT_SECRET_KEY", "secret");
    vi.stubEnv("KLING_DIRECT_API_BASE", "https://kling.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: [{ id: "task-1", status: "failed", message: "rejected", outputs: [] }],
    }), { status: 200 })));
    const result = pollPixazoRequestUntilComplete("https://kling.test/tasks?task_ids=task-1");
    const assertion = expect(result).rejects.toThrow(PROVIDER_TERMINAL_FAILURE);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it("continues polling an accepted direct task when new direct submissions are disabled", async () => {
    vi.useFakeTimers();
    vi.stubEnv("KLING_DIRECT_ENABLED", "false");
    vi.stubEnv("KLING_DIRECT_ACCESS_KEY", "access");
    vi.stubEnv("KLING_DIRECT_SECRET_KEY", "secret");
    vi.stubEnv("KLING_DIRECT_API_BASE", "https://new-base.example.com");
    vi.stubEnv("KLING_DIRECT_POLL_HOSTS", "old-base.example.com");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: [{
        id: "task-1",
        status: "succeed",
        outputs: [{ type: "video", url: "https://cdn.example.com/recovered-direct.mp4" }],
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = pollPixazoRequestUntilComplete(
      "https://old-base.example.com/tasks?task_ids=task-1",
    );
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBe("https://cdn.example.com/recovered-direct.mp4");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://old-base.example.com/tasks?task_ids=task-1",
    );
    expect(fetchMock.mock.calls[0]?.[1].headers.Authorization).toMatch(/^Bearer /);
  });

  it("does not send direct credentials to an unapproved task host", async () => {
    vi.stubEnv("KLING_DIRECT_ENABLED", "false");
    vi.stubEnv("KLING_DIRECT_ACCESS_KEY", "access");
    vi.stubEnv("KLING_DIRECT_SECRET_KEY", "secret");
    vi.stubEnv("PIXAZO_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pollPixazoRequestUntilComplete("https://attacker.example.com/tasks?task_ids=task-1"),
    ).rejects.toThrow("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("stops polling a saved request on a terminal authentication failure", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = pollPixazoRequestUntilComplete(
      "https://gateway.pixazo.ai/v2/requests/status/auth-failure",
    );
    const assertion = expect(result).rejects.toThrow(PROVIDER_API_FAILURE);
    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("continues polling the same request through transient HTTP failures", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "COMPLETED",
        output: { media_url: ["https://cdn.example.com/recovered.mp4"] },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = pollPixazoRequestUntilComplete(
      "https://gateway.pixazo.ai/v2/requests/status/transient",
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBe("https://cdn.example.com/recovered.mp4");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops saved-request polling immediately after ownership is lost", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PIXAZO_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "RUNNING" }), { status: 200 }),
    );
    const assertContinue = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("job no longer owned by this worker"));
    vi.stubGlobal("fetch", fetchMock);

    const result = pollPixazoRequestUntilComplete(
      "https://gateway.pixazo.ai/v2/requests/status/ownership",
      assertContinue,
    );
    const assertion = expect(result).rejects.toThrow(PROVIDER_POLL_ABORTED);
    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies terminal saved-media access failures without retrying a submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadClip("https://cdn.example.com/saved.mp4"))
      .rejects.toThrow(PROVIDER_MEDIA_TERMINAL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});