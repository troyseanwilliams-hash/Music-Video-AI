import { afterEach, describe, expect, it, vi } from "vitest";

const resolveSunoUrl = vi.hoisted(() => vi.fn());
vi.mock("../lib/sunoResolver.js", () => ({ resolveSunoUrl }));

import router from "./suno.js";

const handle = (router as unknown as {
  stack: { route: { stack: { handle: (req: unknown, res: unknown) => Promise<void> }[] } }[];
}).stack[0]!.route.stack[0]!.handle;

function request(url: unknown, authenticated = true) {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  const req = {
    query: { url },
    isAuthenticated: () => authenticated,
    log: { warn: vi.fn() },
  };
  return { req, response };
}

describe("GET /suno/resolve", () => {
  afterEach(() => resolveSunoUrl.mockReset());

  it("requires authentication and a URL without contacting the resolver", async () => {
    const unauthenticated = request("https://suno.com/s/abc", false);
    await handle(unauthenticated.req, unauthenticated.response);
    expect(unauthenticated.response.statusCode).toBe(401);
    const missing = request(undefined);
    await handle(missing.req, missing.response);
    expect(missing.response.statusCode).toBe(400);
    expect(resolveSunoUrl).not.toHaveBeenCalled();
  });

  it("returns the verified track to an authenticated caller", async () => {
    const track = { audioUrl: "https://cdn1.suno.ai/song.mp3", title: "Song", artist: "Suno" };
    resolveSunoUrl.mockResolvedValue(track);
    const { req, response } = request("https://suno.com/s/abc");
    await handle(req, response);
    expect(resolveSunoUrl).toHaveBeenCalledWith(req.query.url);
    expect(response.body).toEqual(track);
  });

  it("returns a client error for unsafe URLs and a retryable error for inaccessible audio", async () => {
    resolveSunoUrl.mockRejectedValueOnce(new Error("Untrusted Suno share redirect"))
      .mockRejectedValueOnce(new Error("Suno audio is unavailable (status 403). Make sure the song is public."));
    const unsafe = request("https://suno.com/s/abc");
    await handle(unsafe.req, unsafe.response);
    expect(unsafe.response.statusCode).toBe(400);
    const privateSong = request("https://suno.com/s/abc");
    await handle(privateSong.req, privateSong.response);
    expect(privateSong.response.statusCode).toBe(502);
    expect(privateSong.response.body).toEqual({
      error: "Suno audio is unavailable (status 403). Make sure the song is public.",
    });
  });
});