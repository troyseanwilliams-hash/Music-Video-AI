import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  withResourceLease: async (_kind: string, fn: (context: { signal: AbortSignal }) => unknown) =>
    fn({ signal: new AbortController().signal }),
}));
import { generateSong, getActiveMusicProvider, isUsableElevenLabsMusicCredential, vocalMusicAvailable } from "./musicApis.js";

const song = { prompt: "Original soul song", lyrics: "[Verse]\nMorning on the lake", withVocals: true };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ELEVENLABS_API_KEY", "sk_abcdefghijklmnopqrstuvwxyz");
  vi.stubEnv("PIXAZO_API_KEY", "fallback-test");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function fallbackResponses() {
  fetchMock.mockResolvedValueOnce(Response.json({ request_id: "test-request" }))
    .mockResolvedValueOnce(Response.json({ status: "COMPLETED", output: { media_url: ["https://audio.example.test/song.mp3"] } }))
    .mockResolvedValueOnce(new Response("test-audio", { headers: { "content-type": "audio/mpeg" } }));
}

describe("safe vocal fallback", () => {
  it.each(["", "key-id-12345", "sk_short", "sk_abcdefghijklmnop qrs", "sk_abcdefghijklmnop!qrst"])("rejects malformed credential %s", key => {
    expect(isUsableElevenLabsMusicCredential(key)).toBe(false);
  });
  it.each(["pixazo", "elevenlabs", "acestep", "musicgen", "simulation"] as const)("pins explicit %s overrides", provider => {
    expect(getActiveMusicProvider(provider, true)).toBe(provider);
  });
  it.each([401,403,400])("uses exactly one fallback after definitive HTTP %s rejection", async status => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: { status: "missing_permissions" } }, { status }));
    fallbackResponses();
    const result = generateSong(song);
    await vi.runAllTimersAsync();
    expect((await result).provider).toBe("pixazo");
    expect(fetchMock.mock.calls.filter(([, opts]) => opts?.method === "POST")).toHaveLength(2);
  });
  it("skips direct submission when configured with a key ID", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "1234567890abcdef");
    fallbackResponses();
    const result = generateSong(song);
    await vi.runAllTimersAsync();
    expect((await result).provider).toBe("pixazo");
    expect(fetchMock.mock.calls.filter(([, opts]) => opts?.method === "POST")).toHaveLength(1);
  });
  it("uses the direct provider when it succeeds", async () => {
    fetchMock.mockResolvedValueOnce(new Response("test-audio"));
    expect((await generateSong(song)).provider).toBe("elevenlabs");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([422,429,500,502,503])("never falls back on HTTP %s even with a misleading credential status", async status => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: { status: "missing_permissions" } }, { status }));
    await expect(generateSong(song)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([
    new DOMException("timed out", "TimeoutError"),
    new Error("network failure"),
  ])("never falls back after an ambiguous transport error", async error => {
    fetchMock.mockRejectedValueOnce(error);
    await expect(generateSong(song)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("never falls back after accepted response audio retrieval fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => { throw new Error("stream interrupted"); } });
    await expect(generateSong(song)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("never falls back after an accepted but empty response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(""));
    await expect(generateSong(song)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("does not switch a pinned direct provider on permission rejection", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status:403 }));
    await expect(generateSong({...song,provider:"elevenlabs"})).rejects.toThrow("temporarily unavailable");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("does not submit if pinned fallback is missing", async () => {
    vi.stubEnv("PIXAZO_API_KEY", "");
    await expect(generateSong({...song,provider:"pixazo"})).rejects.toThrow("temporarily unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not retry when fallback rejects", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", {status:401}))
      .mockResolvedValueOnce(new Response("", {status:503}));
    await expect(generateSong(song)).rejects.toThrow("could not start");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["sk_abcdefghijklmnopqrstuvwxyz", "", true],
    ["key-id", "fallback-test", true],
    ["key-id", "", false],
    ["", "   ", false],
  ] as const)("reports combined availability", (direct, fallback, enabled) => {
    vi.stubEnv("ELEVENLABS_API_KEY", direct);
    vi.stubEnv("PIXAZO_API_KEY", fallback);
    expect(vocalMusicAvailable()).toBe(enabled);
  });
});