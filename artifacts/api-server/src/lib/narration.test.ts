import { describe, expect, it } from "vitest";
import {
  defaultNarrationVoiceId,
  isAllowedNarrationVoice,
  MAX_SCRIPT_CHARS,
  MIN_SCRIPT_CHARS,
  narrationCost,
  NARRATION_VOICES,
  isConclusivePreAcceptanceStatus,
  isOwnerScopedNarrationMusicPath,
  narrationUsesExistingMusic,
  resolveNarrationMusicSource,
} from "./narration.js";
import { isUncertainNarrationSubmission, narrationRefundSplit } from "./narrationProcessor.js";
import { resolveMusic } from "../routes/narration.js";

describe("AIBeatSync narration contract", () => {
  it("charges three credits per started 1,000 characters, minimum three", () => {
    expect(narrationCost(MIN_SCRIPT_CHARS)).toBe(3);
    expect(narrationCost(1_000)).toBe(3);
    expect(narrationCost(1_001)).toBe(6);
    expect(narrationCost(MAX_SCRIPT_CHARS)).toBe(117);
  });

  it("mirrors the proven four-credit optional music surcharge", () => {
    expect(narrationCost(40, true)).toBe(7);
    expect(narrationCost(1_001, true)).toBe(10);
    expect(narrationCost(40, "generated")).toBe(7);
    expect(narrationCost(40, "soundtrack")).toBe(3);
    expect(narrationCost(40, "upload")).toBe(3);
    expect(narrationCost(40, "suno")).toBe(3);
  });

  it("parses explicit music sources while retaining includeMusic compatibility", () => {
    expect(resolveNarrationMusicSource({})).toBe("none");
    expect(resolveNarrationMusicSource({ includeMusic: false })).toBe("none");
    expect(resolveNarrationMusicSource({ includeMusic: true })).toBe("generated");
    expect(resolveNarrationMusicSource({ musicSource: "upload", includeMusic: true })).toBe("upload");
  });

  it("lets both estimate and create's shared resolver use the legacy default prompt", async () => {
    await expect(resolveMusic("user-1", {
      script: "x".repeat(40),
      musicSource: "generated",
    })).resolves.toEqual({ source: "generated" });
  });

  it("only mixes selected stored sources from owner-scoped paths", () => {
    expect(narrationUsesExistingMusic("soundtrack")).toBe(true);
    expect(narrationUsesExistingMusic("upload")).toBe(true);
    expect(narrationUsesExistingMusic("suno")).toBe(true);
    expect(narrationUsesExistingMusic("generated")).toBe(false);
    expect(isOwnerScopedNarrationMusicPath("/objects/audio/user-1/song.mp3", "user-1")).toBe(true);
    expect(isOwnerScopedNarrationMusicPath("/objects/uploads/user-1/song.mp3", "user-1")).toBe(true);
    expect(isOwnerScopedNarrationMusicPath("/objects/audio/user-2/song.mp3", "user-1")).toBe(false);
    expect(isOwnerScopedNarrationMusicPath("https://signed.example/song.mp3", "user-1")).toBe(false);
    expect(isOwnerScopedNarrationMusicPath("/objects/videos/user-1/song.mp3", "user-1")).toBe(false);
    expect(isOwnerScopedNarrationMusicPath("/objects/audio/user-1/not-audio.mp4", "user-1")).toBe(false);
  });

  it("only accepts server-owned voices and defaults to one of them", () => {
    expect(NARRATION_VOICES.length).toBeGreaterThan(0);
    expect(isAllowedNarrationVoice(defaultNarrationVoiceId())).toBe(true);
    expect(isAllowedNarrationVoice("customer-supplied-provider-id")).toBe(false);
  });

  it("treats 5xx and rate limiting as ambiguous, never proven rejection", () => {
    expect(isConclusivePreAcceptanceStatus(400)).toBe(true);
    expect(isConclusivePreAcceptanceStatus(401)).toBe(true);
    expect(isConclusivePreAcceptanceStatus(422)).toBe(true);
    expect(isConclusivePreAcceptanceStatus(429)).toBe(false);
    expect(isConclusivePreAcceptanceStatus(500)).toBe(false);
    expect(isConclusivePreAcceptanceStatus(503)).toBe(false);
  });

  it("stops competing recovery after a timeout or possible post-acceptance failure", () => {
    // Both workers can observe these durable stages after a crash. Neither is
    // allowed to submit again without provider-side reconciliation.
    expect(isUncertainNarrationSubmission("tts_submission_intent", new Error("timeout"))).toBe(true);
    expect(isUncertainNarrationSubmission("tts_submission_intent", new Error("HTTP 503"))).toBe(true);
    expect(isUncertainNarrationSubmission("tts_submission_uncertain", new Error("recovery"))).toBe(true);
    expect(isUncertainNarrationSubmission("tts_accepted", new Error("worker died before storage"))).toBe(true);
    expect(isUncertainNarrationSubmission("music_accepted", new Error("worker died before mix"))).toBe(true);
  });

  it("refunds the exact persisted subscription and top-up split", () => {
    expect(narrationRefundSplit({
      chargedSubscriptionCredits: 5,
      chargedTopupCredits: 2,
    })).toEqual({ subscription: 5, topup: 2, total: 7 });
  });
});