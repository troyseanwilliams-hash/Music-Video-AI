import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadGeneratedImage,
  generateNarrativeImage,
  IMAGE_API_FAILURE,
  IMAGE_POLL_TIMEOUT,
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

  it("keeps polling the saved request after a transient status timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("poll timeout"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "COMPLETED",
          output: { media_url: ["https://example.test/recovered.jpg"] },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = generateNarrativeImage({
      prompt: "A consistent story scene",
      existingPollUrl: "https://example.test/image-status/request-2",
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBe("https://example.test/recovered.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after a malformed transient status response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new SyntaxError("truncated JSON"); },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "COMPLETED",
          output: { media_url: ["https://example.test/recovered-after-json.jpg"] },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = generateNarrativeImage({
      prompt: "A consistent story scene",
      existingPollUrl: "https://example.test/image-status/request-json",
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBe("https://example.test/recovered-after-json.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks an exhausted saved request as a resumable polling timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("status timeout"));
    vi.stubGlobal("fetch", fetchMock);

    const result = generateNarrativeImage({
      prompt: "A consistent story scene",
      existingPollUrl: "https://example.test/image-status/request-timeout",
    });
    const assertion = expect(result).rejects.toThrow(IMAGE_POLL_TIMEOUT);
    await vi.advanceTimersByTimeAsync(120 * 5_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(120);
  });

  it("classifies a rejected image download as an image-stage failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("download timeout")));

    await expect(downloadGeneratedImage("https://example.test/generated.jpg"))
      .rejects.toThrow(IMAGE_API_FAILURE);
  });

  it("rejects a non-image provider response before it can be stored", async () => {
    const html = Buffer.from("<html><body>temporary gateway error</body></html>".repeat(40));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => html,
    }));

    await expect(downloadGeneratedImage("https://example.test/generated.jpg"))
      .rejects.toThrow("invalid and was not added");
  });

  it("rejects a spoofed JPEG signature without a valid image structure", async () => {
    const fakeJpeg = Buffer.alloc(1_024, 0);
    fakeJpeg.set([0xff, 0xd8, 0xff], 0);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => fakeJpeg,
    }));

    await expect(downloadGeneratedImage("https://example.test/generated.jpg"))
      .rejects.toThrow("invalid and was not added");
  });

  it("accepts a structurally valid generated PNG payload", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => png,
    }));

    await expect(downloadGeneratedImage("https://example.test/generated.png"))
      .resolves.toEqual(png);
  });
});