import { describe, expect, it } from "vitest";
import {
  retryProviderAfterTerminalFailure,
  terminalSceneRecovery,
} from "./terminalSceneRecovery.js";

describe("terminalSceneRecovery", () => {
  it("targets one archived terminal scene inside the plan", () => {
    expect(terminalSceneRecovery({
      storyboard: { numClips: 30 },
      rejectedRequests: { "19": { reason: "rejected" } },
      pendingRequests: { "20": "saved-unrelated-request" },
    }, "AI scene ERROR")).toEqual({ sceneKey: "19", unsafe: false });
  });

  it("targets one legacy terminal pending handle inside the plan", () => {
    expect(terminalSceneRecovery({
      storyboard: { numClips: 30 },
      pendingRequests: { "19": "terminal-request" },
    }, "Generation failed: the request was rejected.")).toEqual({
      sceneKey: "19",
      unsafe: false,
    });
  });

  it("blocks a terminal failure with no identifiable scene", () => {
    expect(terminalSceneRecovery({
      storyboard: { numClips: 30 },
    }, "AI scene ERROR")).toEqual({ sceneKey: null, unsafe: true });
  });

  it("blocks ambiguous or out-of-plan terminal scene state", () => {
    expect(terminalSceneRecovery({
      storyboard: { numClips: 30 },
      pendingRequests: { "19": "request-a", "20": "request-b" },
    }, "AI scene failed")).toEqual({ sceneKey: null, unsafe: true });

    expect(terminalSceneRecovery({
      storyboard: { numClips: 30 },
      rejectedRequests: { "30": { reason: "rejected" } },
    }, "AI scene failed")).toEqual({ sceneKey: null, unsafe: true });
  });

  it("does not classify a nonterminal pending request as a fresh submission", () => {
    expect(terminalSceneRecovery({
      storyboard: { numClips: 30 },
      pendingRequests: { "19": "uncertain-request" },
    }, "Provider status request failed with HTTP 401")).toEqual({
      sceneKey: null,
      unsafe: false,
    });
  });
});

describe("retryProviderAfterTerminalFailure", () => {
  it("retries a legacy gateway Runway failure through direct Runway", () => {
    expect(retryProviderAfterTerminalFailure({
      generationProvider: "runway",
      rejectedRequests: {
        "19": {
          pollUrl: "https://gateway.pixazo.ai/v2/requests/status/runway-gen-4-5_request",
        },
      },
    }, "kling", "19")).toBe("runway");
  });

  it("switches to Kling after a direct Runway task fails", () => {
    expect(retryProviderAfterTerminalFailure({
      generationProvider: "runway",
      rejectedRequests: {
        "19": {
          provider: "runway",
          pollUrl: "https://api.dev.runwayml.com/v1/tasks/direct-runway-task",
        },
      },
    }, "runway", "19")).toBe("kling");
  });

  it("does not switch providers for a failure without a terminal scene", () => {
    expect(retryProviderAfterTerminalFailure({
      generationProvider: "runway",
    }, "runway", null)).toBe("runway");
  });

  it("preserves a non-Runway provider for a terminal scene", () => {
    expect(retryProviderAfterTerminalFailure({
      generationProvider: "luma",
      rejectedRequests: {
        "4": { provider: "luma" },
      },
    }, "luma", "4")).toBe("luma");
  });

  it("trusts failed-scene provider evidence over stale Runway metadata", () => {
    expect(retryProviderAfterTerminalFailure({
      generationProvider: "runway",
      rejectedRequests: {
        "4": { provider: "luma" },
      },
    }, "kling", "4")).toBe("kling");
  });
});