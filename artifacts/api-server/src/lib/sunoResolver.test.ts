import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTrustedSunoCdn,
  isCanonicalSunoShareUrl,
  isTrustedSunoCdnUrl,
} from "./sunoResolver.js";

const songId = "123e4567-e89b-12d3-a456-426614174000";

describe("Suno import URL safety", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("allows only canonical Suno share URLs", () => {
    expect(isCanonicalSunoShareUrl(`https://suno.com/song/${songId}`)).toBe(true);
    expect(isCanonicalSunoShareUrl(`https://www.suno.ai/song/${songId}/`)).toBe(true);
    expect(isCanonicalSunoShareUrl(`http://127.0.0.1/song/${songId}`)).toBe(false);
    expect(isCanonicalSunoShareUrl(`https://suno.com.evil.test/song/${songId}`)).toBe(false);
    expect(isCanonicalSunoShareUrl(`https://user@suno.com/song/${songId}`)).toBe(false);
    expect(isCanonicalSunoShareUrl(`https://suno.com:8443/song/${songId}`)).toBe(false);
  });

  it("allows only the resolver's exact audio CDN", () => {
    expect(isTrustedSunoCdnUrl(`https://cdn1.suno.ai/${songId}.mp3`)).toBe(true);
    expect(isTrustedSunoCdnUrl(`https://cdn1.suno.ai.evil.test/${songId}.mp3`)).toBe(false);
    expect(isTrustedSunoCdnUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
  });

  it("rejects a CDN redirect that escapes the trusted allowlist", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTrustedSunoCdn(`https://cdn1.suno.ai/${songId}.mp3`)).rejects
      .toThrow("Untrusted Suno download location");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});