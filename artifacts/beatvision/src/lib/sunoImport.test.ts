import { afterEach, describe, expect, it, vi } from "vitest";
import { importSunoTrack, isSunoShareUrl } from "./sunoImport";

const song = "https://suno.com/song/12345678-1234-1234-1234-123456789abc";

afterEach(() => vi.unstubAllGlobals());

describe("Suno import request", () => {
  it("blocks deceptive hosts, insecure URLs and ports before any request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const value of [`https://evil.example/${song}`, `http://suno.com/song/${song.split("/").pop()}`, song.replace("suno.com", "suno.com:443")]) {
      expect(isSunoShareUrl(value)).toBe(false);
      await expect(importSunoTrack(value)).rejects.toThrow("valid HTTPS Suno");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces an import error and supports retry without a resolve request", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Track is private" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ objectPath: "/objects/song", url: "/audio/song", title: "Song" }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(importSunoTrack(song)).rejects.toThrow("Track is private");
    await expect(importSunoTrack(song)).resolves.toEqual({ objectPath: "/objects/song", url: "/audio/song", title: "Song" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe("/api/audio/import-from-link");
  });

  it("passes abort signal to the request so a cancelled source cannot complete", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetcher);
    const request = importSunoTrack(song, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
  });
});