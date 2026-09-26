import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadLegacySunoAudio,
  fetchTrustedSunoCdn,
  isCanonicalSunoShareUrl,
  isSunoShareUrl,
  isTrustedSunoCdnUrl,
  resolveSunoUrl,
} from "./sunoResolver.js";

const songId = "123e4567-e89b-12d3-a456-426614174000";

describe("Suno import URL safety", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("allows only canonical Suno share URLs", () => {
    expect(isCanonicalSunoShareUrl(`https://suno.com/song/${songId}`)).toBe(true);
    expect(isCanonicalSunoShareUrl(`https://suno.com/song/${songId}?utm_source=share#play`)).toBe(true);
    expect(isCanonicalSunoShareUrl(`https://suno.com/song/${songId}?next=https%3A%2F%2Fexample.com%3A8443#at:15`)).toBe(true);
    expect(isSunoShareUrl("https://suno.com/s/aBc_123?utm_source=https%3A%2F%2Fexample.com%3A443#play:1")).toBe(true);
    expect(isCanonicalSunoShareUrl(`https://www.suno.ai/song/${songId}/`)).toBe(true);
    expect(isCanonicalSunoShareUrl(`http://127.0.0.1/song/${songId}`)).toBe(false);
    expect(isCanonicalSunoShareUrl(`https://suno.com.evil.test/song/${songId}`)).toBe(false);
    expect(isCanonicalSunoShareUrl(`https://user@suno.com/song/${songId}`)).toBe(false);
    expect(isCanonicalSunoShareUrl(`https://suno.com:8443/song/${songId}`)).toBe(false);
    expect(isCanonicalSunoShareUrl(`https://suno.com:443/song/${songId}`)).toBe(false);
  });

  it("only permits short links on explicit Suno hosts and without credentials or ports", () => {
    expect(isSunoShareUrl("https://suno.com/s/aBc_123")).toBe(true);
    for (const url of [
      "https://suno.com.evil.test/s/aBc", "http://suno.com/s/aBc",
      "https://user@suno.com/s/aBc", "https://suno.com:8443/s/aBc",
      "https://127.0.0.1/s/aBc", "file:///s/aBc",
    ]) expect(isSunoShareUrl(url)).toBe(false);
  });

  it("resolves a canonical song with harmless query and audio HEAD", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) =>
      init.method === "HEAD"
        ? new Response(null, { status: 200, headers: { "content-type": "audio/mpeg" } })
        : new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveSunoUrl(`https://suno.com/song/${songId}?share=1#top`))
      .resolves.toMatchObject({ audioUrl: `https://cdn1.suno.ai/${songId}.mp3` });
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://cdn1.suno.ai/${songId}.mp3`);
  });

  it("follows only bounded allowlisted Suno short-link redirects", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url === "https://suno.com/s/abc") return new Response(null, {
        status: 302, headers: { location: `/song/${songId}?share=1` },
      });
      return init.method === "HEAD"
        ? new Response(null, { status: 200, headers: { "content-type": "audio/mpeg" } })
        : new Response("");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveSunoUrl("https://suno.com/s/abc")).resolves
      .toMatchObject({ audioUrl: `https://cdn1.suno.ai/${songId}.mp3` });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual", method: "HEAD" });
  });

  it("probes a short link with a range GET if HEAD is unsupported", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url === "https://suno.com/s/abc") {
        return init.method === "HEAD"
          ? new Response(null, { status: 405 })
          : new Response(null, { status: 302, headers: { location: `/song/${songId}` } });
      }
      return init.method === "HEAD"
        ? new Response(null, { status: 200, headers: { "content-type": "audio/mpeg" } })
        : new Response("");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveSunoUrl("https://suno.com/s/abc")).resolves.toHaveProperty("title", songId);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "GET", headers: { Range: "bytes=0-0" }, redirect: "manual" });
  });

  it.each(["http://127.0.0.1/private", "https://evil.test/song/" + songId, "https://suno.com:8443/song/" + songId])(
    "blocks short-link redirects to %s before fetching them", async (target) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: target } }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(resolveSunoUrl("https://suno.com/s/abc")).rejects.toThrow("Untrusted");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("falls back from HEAD 405 to a bounded range GET and rejects HTML", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("suno.com/song/")) return new Response("");
      if (init.method === "HEAD") return new Response(null, { status: 405 });
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), { status: 206, headers: { "content-type": "audio/mpeg" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveSunoUrl(`https://suno.com/song/${songId}`)).resolves.toHaveProperty("artist", "Suno");
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "GET", headers: { Range: "bytes=0-1023" } });
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) =>
      init.method === "HEAD" ? new Response(null, { status: 405 })
        : new Response("<html>blocked</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(resolveSunoUrl(`https://suno.com/song/${songId}`)).rejects.toThrow("invalid audio");
  });

  it.each([403, 404])("reports unavailable public audio (GET %s)", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init: RequestInit) =>
      new Response(null, { status: init.method === "HEAD" ? 405 : status })));
    await expect(resolveSunoUrl(`https://suno.com/song/${songId}`)).rejects.toThrow(`status ${status}`);
  });

  it("reports network timeout after the fallback also fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(resolveSunoUrl(`https://suno.com/song/${songId}`)).rejects.toThrow("network timeout");
    await expect(resolveSunoUrl("https://suno.com/s/abc")).rejects.toThrow("network timeout");
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

  it("keeps pre-import CDN-only jobs on an allowlisted bounded compatibility path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([73, 68, 51, 4]), {
      status: 200, headers: { "content-type": "audio/mpeg" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadLegacySunoAudio(`https://cdn1.suno.ai/${songId}.mp3`)).resolves.toEqual(Buffer.from([73, 68, 51, 4]));
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
    await expect(downloadLegacySunoAudio("http://127.0.0.1/private")).rejects.toThrow("trusted CDN");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects HTML and forbidden redirects for legacy CDN-only jobs", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302, headers: { location: "http://127.0.0.1/private" },
    })).mockResolvedValueOnce(new Response("<html>not audio</html>", {
      status: 200, headers: { "content-type": "text/html" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadLegacySunoAudio(`https://cdn1.suno.ai/${songId}.mp3`)).rejects.toThrow("Untrusted Suno download location");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(downloadLegacySunoAudio(`https://cdn1.suno.ai/${songId}.mp3`)).rejects.toThrow("page instead of audio");
  });

  it("returns an actionable legacy CDN timeout without downloading anything else", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadLegacySunoAudio(`https://cdn1.suno.ai/${songId}.mp3`))
      .rejects.toThrow("unreachable or timed out");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});