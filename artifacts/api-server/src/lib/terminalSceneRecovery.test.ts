import { describe, expect, it } from "vitest";
import { terminalSceneRecovery } from "./terminalSceneRecovery.js";

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