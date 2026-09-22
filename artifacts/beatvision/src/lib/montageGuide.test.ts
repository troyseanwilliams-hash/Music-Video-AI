import { describe, expect, it } from "vitest";
import {
  canContinueMontageStep,
  deriveMontageGuideProgress,
  isMontageExportCostKnown,
  montageGuideStorageKey,
  readMontageGuideProgress,
  restartMontageGuide,
  validateMontageGuideProgress,
  writeMontageGuideProgress,
} from "./montageGuide";

describe("montage guide progress", () => {
  it("validates persisted data and removes unknown completed steps", () => {
    expect(validateMontageGuideProgress({
      version: 1, status: "active", step: "media", completed: ["audio", "unknown"],
    })).toEqual({ version: 1, status: "active", step: "media", completed: ["audio"] });
    expect(validateMontageGuideProgress({ version: 2 })).toBeNull();
  });

  it("uses an account-scoped key and tolerates unavailable storage", () => {
    expect(montageGuideStorageKey("user-a")).not.toBe(montageGuideStorageKey("user-b"));
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readMontageGuideProgress("user-a", broken)).toBeNull();
    expect(writeMontageGuideProgress("user-a", {
      version: 1, status: "active", step: "audio", completed: [],
    }, broken)).toBe(false);
  });

  it("skips completed acquisition without overriding intentional Back", () => {
    const context = { hasAudio: true, hasMedia: true, arranged: false, previewPlayed: false };
    expect(deriveMontageGuideProgress(null, context).step).toBe("arrange");
    expect(deriveMontageGuideProgress({
      version: 1, status: "active", step: "audio", completed: [],
    }, context).step).toBe("arrange");
    expect(deriveMontageGuideProgress({
      version: 1, status: "active", step: "media", completed: ["audio", "media"],
    }, context).step).toBe("media");
  });

  it("invalidates media readiness and preview when the draft becomes empty", () => {
    const result = deriveMontageGuideProgress({
      version: 1,
      status: "active",
      step: "export",
      completed: ["media", "arrange", "preview"],
    }, { hasAudio: false, hasMedia: false, arranged: false, previewPlayed: false });
    expect(result.completed).toEqual([]);
    expect(result.step).toBe("audio");
  });

  it("requires confirmed photo or video playback", () => {
    const base = { hasAudio: false, hasMedia: true, arranged: true, previewPlayed: false };
    expect(canContinueMontageStep("preview", base)).toBe(false);
    // Both media engines report through the same confirmed-playback flag.
    expect(canContinueMontageStep("preview", { ...base, previewPlayed: true })).toBe(true);
  });

  it("lets a one-item default timeline be explicitly accepted", () => {
    const defaultOrder = { hasAudio: false, hasMedia: true, arranged: false, previewPlayed: false };
    expect(canContinueMontageStep("arrange", defaultOrder)).toBe(false);
    expect(canContinueMontageStep("arrange", { ...defaultOrder, arranged: true })).toBe(true);
  });

  it("does not treat an unavailable required quota as a free estimate", () => {
    expect(isMontageExportCostKnown({
      fullAccess: false, trialActive: false, karaokeHasLyrics: false, quotaLoaded: false,
    })).toBe(false);
    expect(isMontageExportCostKnown({
      fullAccess: true, trialActive: false, karaokeHasLyrics: false, quotaLoaded: false,
    })).toBe(true);
  });

  it("restarts a submitted guide against the current project", () => {
    const restarted = restartMontageGuide({
      hasAudio: true, hasMedia: false, arranged: false, previewPlayed: false,
    });
    expect(restarted.status).toBe("active");
    expect(restarted.step).toBe("media");
    expect(restarted.completed).not.toContain("export");
  });
});