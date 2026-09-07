import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNewJobVideoProvider } from "./videoProviderSelection.js";

describe("resolveNewJobVideoProvider", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("leaves existing Kling selection gateway-backed unless the enabled cutover is explicit", () => {
    vi.stubEnv("KLING_DIRECT_ENABLED", "true");
    vi.stubEnv("KLING_DIRECT_ACCESS_KEY", "access");
    vi.stubEnv("KLING_DIRECT_SECRET_KEY", "secret");
    vi.stubEnv("KLING_DIRECT_NEW_JOBS", "false");
    expect(resolveNewJobVideoProvider("kling")).toBe("kling");

    vi.stubEnv("KLING_DIRECT_NEW_JOBS", "true");
    expect(resolveNewJobVideoProvider("kling")).toBe("kling_direct");
  });

  it("does not cut over when direct Kling is incompletely configured", () => {
    vi.stubEnv("KLING_DIRECT_ENABLED", "true");
    vi.stubEnv("KLING_DIRECT_NEW_JOBS", "true");
    vi.stubEnv("KLING_DIRECT_ACCESS_KEY", "access");
    vi.stubEnv("KLING_DIRECT_SECRET_KEY", "");
    expect(resolveNewJobVideoProvider("kling")).toBe("kling");
  });
});