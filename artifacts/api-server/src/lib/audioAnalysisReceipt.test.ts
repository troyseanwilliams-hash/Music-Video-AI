import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signAudioAnalysisReceipt,
  verifyAudioAnalysisReceipt,
} from "./audioAnalysisReceipt.js";

const analysis = {
  bpm: 120,
  durationSeconds: 180,
  mood: "energetic",
  sections: [{ startTime: 0, endTime: 180, label: "song", energy: 0.7 }],
};

describe("audio analysis receipts", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "receipt-test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies the exact server-produced analysis for the same user and object", () => {
    const receipt = signAudioAnalysisReceipt({
      userId: "user-1",
      objectPath: "/audio/song.mp3",
      analysis,
      now: 1_000,
    });

    expect(
      verifyAudioAnalysisReceipt({
        userId: "user-1",
        objectPath: "/audio/song.mp3",
        analysis: { ...analysis, analysisReceipt: receipt },
        receipt,
        now: 2_000,
      }),
    ).toEqual(analysis);
  });

  it("rejects a forged duration so Full-track billing cannot be changed by the browser", () => {
    const receipt = signAudioAnalysisReceipt({
      userId: "user-1",
      objectPath: "/audio/song.mp3",
      analysis,
      now: 1_000,
    });

    expect(
      verifyAudioAnalysisReceipt({
        userId: "user-1",
        objectPath: "/audio/song.mp3",
        analysis: { ...analysis, durationSeconds: 30, analysisReceipt: receipt },
        receipt,
        now: 2_000,
      }),
    ).toBeNull();
  });

  it("rejects receipts replayed for another user, object, or after expiry", () => {
    const receipt = signAudioAnalysisReceipt({
      userId: "user-1",
      objectPath: "/audio/song.mp3",
      analysis,
      now: 1_000,
    });

    expect(
      verifyAudioAnalysisReceipt({
        userId: "user-2",
        objectPath: "/audio/song.mp3",
        analysis,
        receipt,
        now: 2_000,
      }),
    ).toBeNull();
    expect(
      verifyAudioAnalysisReceipt({
        userId: "user-1",
        objectPath: "/audio/other.mp3",
        analysis,
        receipt,
        now: 2_000,
      }),
    ).toBeNull();
    expect(
      verifyAudioAnalysisReceipt({
        userId: "user-1",
        objectPath: "/audio/song.mp3",
        analysis,
        receipt,
        now: 1_000 + 24 * 60 * 60 * 1000 + 1,
      }),
    ).toBeNull();
  });
});