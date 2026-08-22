import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveClipProviderChain } from "./videoApis.js";

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
});