import { describe, expect, it, vi } from "vitest";
import {
  clipContentHash,
  securelyDownloadTrustedClip,
  validateClipAttachment,
  type AdminClipAttachmentMeta,
} from "./adminClipAttachments.js";

const providerUrl = "https://cdn.runway.example/video/scene-1.mp4";

function strictMeta(overrides: Partial<AdminClipAttachmentMeta> = {}): AdminClipAttachmentMeta {
  return {
    strictUniqueSourcesVersion: 1,
    storyboard: { numClips: 3 },
    pendingRequests: {
      "0": "https://cdn.runway.example/status/zero",
      "1": "https://cdn.runway.example/status/one",
      "2": "https://cdn.runway.example/status/two",
    },
    partialClips: {},
    ...overrides,
  };
}

describe("strict admin clip attachment validation", () => {
  it("rejects the same URL at two indexes", () => {
    const accepted = new Set<string>();
    const first = validateClipAttachment(strictMeta(), { index: 0, url: providerUrl }, accepted);
    expect(first.ok).toBe(true);
    if (first.ok) accepted.add(first.clip.url);

    const second = validateClipAttachment(strictMeta(), { index: 1, url: providerUrl }, accepted);
    expect(second).toMatchObject({ ok: false });
    if (!second.ok) expect(second.error).toContain("same clip URL");
  });

  it("rejects an out-of-range storyboard index", () => {
    const result = validateClipAttachment(
      strictMeta({
        pendingRequests: { "3": "https://cdn.runway.example/status/three" },
      }),
      { index: 3, url: "https://cdn.runway.example/video/three.mp4" },
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("outside");
  });

  it("rejects an attempt to overwrite an existing partial clip", () => {
    const result = validateClipAttachment(
      strictMeta({ partialClips: { "1": "/clips/existing.mp4" } }),
      { index: 1, url: providerUrl },
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("overwrite");
  });

  it("rejects an origin not represented by provider evidence", () => {
    const result = validateClipAttachment(
      strictMeta(),
      { index: 1, url: "https://attacker.example/video.mp4" },
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("not trusted");
  });

  it("allows recovery of a missing in-range index without changing its mapping", () => {
    const result = validateClipAttachment(
      strictMeta({ partialClips: { "0": "/clips/zero.mp4", "2": "/clips/two.mp4" } }),
      { index: 1, url: providerUrl },
    );
    expect(result).toMatchObject({
      ok: true,
      clip: { index: 1, url: providerUrl },
    });
  });
});

describe("trusted clip downloader SSRF defenses", () => {
  const publicLookup = vi.fn(async () => [{ address: "203.0.113.10" }]);

  it("rejects a redirect to an untrusted origin before following it", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/internal" },
    }));
    await expect(securelyDownloadTrustedClip(
      providerUrl,
      new Set(["https://cdn.runway.example"]),
      { fetchImpl: fetchImpl as typeof fetch, lookupAddresses: publicLookup },
    )).rejects.toThrow("not trusted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    "127.0.0.1",
    "10.2.3.4",
    "169.254.169.254",
    "::1",
    "fe80::1",
  ])("rejects private, loopback, or link-local destination %s", async (address) => {
    const fetchImpl = vi.fn();
    await expect(securelyDownloadTrustedClip(
      providerUrl,
      new Set(["https://cdn.runway.example"]),
      {
        fetchImpl: fetchImpl as typeof fetch,
        lookupAddresses: async () => [{ address }],
      },
    )).rejects.toThrow("private, loopback, or link-local");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("downloads from an evidence-backed public origin", async () => {
    const bytes = Buffer.alloc(12_000, 7);
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200 }));
    const downloaded = await securelyDownloadTrustedClip(
      providerUrl,
      new Set(["https://cdn.runway.example"]),
      { fetchImpl: fetchImpl as typeof fetch, lookupAddresses: publicLookup },
    );
    expect(downloaded).toEqual(bytes);
    expect(clipContentHash(downloaded)).toHaveLength(64);
  });
});