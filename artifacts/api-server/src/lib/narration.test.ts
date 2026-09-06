import { describe, expect, it } from "vitest";
import {
  defaultNarrationVoiceId,
  isAllowedNarrationVoice,
  MAX_SCRIPT_CHARS,
  MIN_SCRIPT_CHARS,
  narrationCost,
  NARRATION_VOICES,
  isConclusivePreAcceptanceStatus,
} from "./narration.js";
import { isUncertainNarrationSubmission } from "./narrationProcessor.js";

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
});