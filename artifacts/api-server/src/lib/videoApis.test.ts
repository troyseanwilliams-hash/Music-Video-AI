import { afterEach, describe, expect, it, vi } from "vitest";
import { generateClip, resolveClipProviderChain } from "./videoApis.js";

describe("resolveClipProviderChain", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
});