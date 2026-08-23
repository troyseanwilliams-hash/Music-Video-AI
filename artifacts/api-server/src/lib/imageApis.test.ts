import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadGeneratedImage,
  generateNarrativeImage,
  IMAGE_API_FAILURE,
  singleSceneImagePrompt,
} from "./imageApis.js";

describe("generateNarrativeImage recovery", () => {
  const originalKey = process.env.PIXAZO_API_KEY;

  beforeEach(() => {
    process.env.PIXAZO_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalKey === undefined) delete process.env.PIXAZO_API_KEY;
    else process.env.PIXAZO_API_KEY = originalKey;
  });

  it("keeps the single-scene rule intact when a long brief is truncated", () => {
    const prompt = singleSceneImagePrompt("scene ".repeat(1_000));

    expect(prompt).toHaveLength(3_000);
    expect(prompt).toContain("Generate exactly one image for exactly one requested segment.");
    expect(prompt).toContain("Do not create a collage, triptych, diptych, grid, contact sheet, split screen, panels, montage, storyboard, or multi-frame composition.");
  });

  it("polls a saved request without submitting another paid image request", async () => {
    vi.useFakeTimers();
    const pollUrl = "https://example.test/image-status/request-1";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "COMPLETED",
        output: { media_url: ["https://example.test/generated.jpg"] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSubmit = vi.fn();

    const result = generateNarrativeImage({
      prompt: "A consistent story scene",
      aspectRatio: "16:9",
      existingPollUrl: pollUrl,
      onSubmit,
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBe("https://example.test/generated.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(pollUrl);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("records an uncertain state when submission transport fails", async () => {
    const onUncertainSubmission = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset")));

    await expect(generateNarrativeImage({
      prompt: "A consistent story scene",
      onUncertainSubmission,
    })).rejects.toThrow(IMAGE_API_FAILURE);
    expect(onUncertainSubmission).toHaveBeenCalledWith(expect.objectContaining({
      reason: expect.stringContaining("connection reset"),
    }));
  });

  it("sends the private reference as an image-editing input", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          request_id: "request-with-reference",
          polling_url: "https://example.test/image-status/request-with-reference",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "COMPLETED",
          output: { media_url: ["https://example.test/generated-with-reference.jpg"] },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = generateNarrativeImage({
      prompt: "Keep the same character across the image pack",
      aspectRatio: "9:16",
      referenceImageUrl: "https://example.test/private-reference.jpg?signature=test",
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBe("https://example.test/generated-with-reference.jpg");
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const submittedBody = JSON.parse(String(requestInit.body)) as { prompt?: string; input_image?: string };
    expect(submittedBody).toMatchObject({
      input_image: "https://example.test/private-reference.jpg?signature=test",
    });
    expect(submittedBody.prompt).toContain("Keep the same character across the image pack");
    expect(submittedBody.prompt).toContain("Generate exactly one image for exactly one requested segment.");
    expect(submittedBody.prompt).toContain("Do not create a collage, triptych, diptych, grid, contact sheet, split screen, panels, montage, storyboard, or multi-frame composition.");
  });

  it("classifies a rejected saved-poll request as an image-stage failure", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("poll timeout")));

    const result = generateNarrativeImage({
      prompt: "A consistent story scene",
      existingPollUrl: "https://example.test/image-status/request-2",
    });
    const rejection = expect(result).rejects.toThrow(IMAGE_API_FAILURE);
    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
  });

  it("classifies a rejected image download as an image-stage failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("download timeout")));

    await expect(downloadGeneratedImage("https://example.test/generated.jpg"))
      .rejects.toThrow(IMAGE_API_FAILURE);
  });
});