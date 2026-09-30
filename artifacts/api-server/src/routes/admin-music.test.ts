import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateSong: vi.fn(),
  uploadAudioBuffer: vi.fn(),
  getObjectEntitySignedUrl: vi.fn(),
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() },
}));

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: mocks.db,
}));
vi.mock("../lib/musicApis.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/musicApis.js")>()),
  generateSong: mocks.generateSong,
}));
vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: class {
    uploadAudioBuffer = mocks.uploadAudioBuffer;
    getObjectEntitySignedUrl = mocks.getObjectEntitySignedUrl;
  },
}));

import router from "./admin-music.js";
import { calculateSongCost } from "../lib/creditCost.js";

const trialUser = { id: "new-user", email: "new@example.test", subscriptionStatus: "trial" };
function handler() {
  const layer = (router as any).stack.find(
    (candidate: any) => candidate.route?.path === "/admin/music/generate",
  );
  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}
function request() {
  return {
    isAuthenticated: () => true,
    user: trialUser,
    body: { prompt: "Gentle acoustic piano", durationSeconds: 30 },
  };
}
function response() {
  return {
    statusCode: 200,
    body: null as any,
    headersSent: false,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
  };
}

describe("trial music credit reservation", () => {
  let balance: { creditsRemaining: number; welcomeCredits: number; topupCredits: number; subscriptionCredits: number; creditsUsed: number; freeSoundtracksResetAt: null; freeSoundtracksUsed: number };
  beforeEach(() => {
    vi.clearAllMocks();
    balance = {
      creditsRemaining: 110,
      welcomeCredits: 0,
      topupCredits: 110,
      subscriptionCredits: 0,
      creditsUsed: 0,
      freeSoundtracksResetAt: null,
      freeSoundtracksUsed: 0,
    };
    const chain = (row: () => any) => {
      const builder: any = {};
      builder.from = () => builder;
      builder.where = () => builder;
      builder.limit = () => builder;
      builder.for = async () => [row()];
      builder.then = (resolve: (value: any[]) => void) => resolve([row()]);
      return builder;
    };
    mocks.db.select.mockImplementation(() => chain(() => trialUser));
    let creditUpdates = 0;
    const tx = {
      insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
      select: () => chain(() => ({ ...balance })),
      update: () => ({ set: (changes: any) => ({ where: async () => {
        if (changes.creditsRemaining) {
          const cost = calculateSongCost(30);
          const multiplier = creditUpdates++ === 0 ? -1 : 1;
          balance.creditsRemaining += multiplier * cost;
          balance.topupCredits += multiplier * cost;
          balance.creditsUsed -= multiplier * cost;
        }
      } }) }),
    };
    mocks.db.transaction.mockImplementation((fn: (transaction: any) => any) => fn(tx));
    mocks.db.update.mockImplementation(() => ({ set: () => ({ where: async () => {
      const cost = calculateSongCost(30);
      balance.creditsRemaining += cost;
      balance.topupCredits += cost;
      balance.creditsUsed -= cost;
    } }) }));
    mocks.db.insert.mockImplementation(() => ({ values: async () => {} }));
    mocks.uploadAudioBuffer.mockResolvedValue("/objects/generated/song.mp3");
    mocks.getObjectEntitySignedUrl.mockResolvedValue("https://example.test/song");
    mocks.generateSong.mockResolvedValue({
      audioBuffer: Buffer.from("song"), ext: "mp3", provider: "musicgen", hasVocals: false,
    });
  });

  it("rejects insufficient balance before calling the provider", async () => {
    balance.creditsRemaining = 0;
    balance.topupCredits = 0;
    const res = response();
    await handler()(request(), res);
    expect(res.statusCode).toBe(402);
    expect(res.body.code).toBe("INSUFFICIENT_CREDITS");
    expect(mocks.generateSong).not.toHaveBeenCalled();
  });

  it("charges welcome credits for instrumental music and preserves a durable song", async () => {
    const res = response();
    await handler()(request(), res);
    const cost = calculateSongCost(30);
    expect(res.body.creditsCharged).toBe(cost);
    expect(res.body.wasFree).toBe(false);
    expect(balance.creditsRemaining).toBe(110 - cost);
    expect(mocks.db.insert).toHaveBeenCalledOnce();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("returns the exact reserved balance when the provider fails", async () => {
    mocks.generateSong.mockRejectedValueOnce(new Error("Provider failed"));
    const res = response();
    await handler()(request(), res);
    expect(res.statusCode).toBe(500);
    expect(balance).toMatchObject({ creditsRemaining: 110, topupCredits: 110, creditsUsed: 0 });
    expect(mocks.uploadAudioBuffer).not.toHaveBeenCalled();
  });

  it("does not refund a saved soundtrack when writing the response throws", async () => {
    const res = response();
    res.json = () => { throw new Error("Connection lost"); };
    // The handler still tries to surface an error; suppress the fake response's
    // second write to focus this test on persisted-track charge integrity.
    res.headersSent = true;
    await handler()(request(), res);
    expect(balance.creditsRemaining).toBe(110 - calculateSongCost(30));
    expect(mocks.db.update).not.toHaveBeenCalled();
  });
});