import { describe, expect, it } from "vitest";
import { planShots } from "./shotPlan.js";

const THREE_MINUTE_ANALYSIS = {
  bpm: 118,
  mood: "cinematic",
  durationSeconds: 180,
  sections: [
    { startTime: 0, endTime: 20, label: "intro", energy: 0.25 },
    { startTime: 20, endTime: 50, label: "verse", energy: 0.5 },
    { startTime: 50, endTime: 75, label: "chorus", energy: 0.9 },
    { startTime: 75, endTime: 105, label: "verse", energy: 0.55 },
    { startTime: 105, endTime: 135, label: "bridge", energy: 0.7 },
    { startTime: 135, endTime: 165, label: "chorus", energy: 0.95 },
    { startTime: 165, endTime: 180, label: "outro", energy: 0.35 },
  ],
};

describe("planShots montage planning", () => {
  it("uses six paid visuals across eighteen intentional timeline cuts for a three-minute track", () => {
    const plan = planShots({
      prompt: "A rider enters the desert. Then a storm arrives. Finally sunrise breaks over the mountains.",
      style: "cinematic",
      requestedDuration: "full",
      analysis: THREE_MINUTE_ANALYSIS,
    });

    expect(plan.numClips).toBe(6);
    expect(plan.shots).toHaveLength(6);
    expect(plan.timeline).toHaveLength(18);
    expect(plan.timelineSceneCount).toBe(18);
    expect(plan.reuseCount).toBe(12);
    expect(plan.timeline.reduce((sum, scene) => sum + scene.duration, 0)).toBe(180);
    expect(plan.timeline.every((scene) => scene.duration <= 10)).toBe(true);
  });

  it("never places the same visual in consecutive montage slots when alternatives exist", () => {
    const plan = planShots({
      prompt: "Neon city lights and a dancer moving through rain",
      style: "neon",
      requestedDuration: "full",
      analysis: THREE_MINUTE_ANALYSIS,
    });

    for (let index = 1; index < plan.timeline.length; index++) {
      expect(plan.timeline[index]!.visualIndex).not.toBe(plan.timeline[index - 1]!.visualIndex);
    }
    expect(new Set(plan.timeline.slice(0, plan.numClips).map((scene) => scene.visualIndex)).size).toBe(plan.numClips);
  });

  it("splits a multi-beat prompt into focused visual motifs instead of repeating the full story", () => {
    const prompt = "A rider enters the desert. Then a storm arrives. Finally sunrise breaks over the mountains.";
    const plan = planShots({
      prompt,
      requestedDuration: "full",
      analysis: THREE_MINUTE_ANALYSIS,
    });

    expect(plan.shots.every((shot) => shot.prompt.includes(prompt))).toBe(false);
    expect(plan.shots.every((shot) => shot.prompt.includes("one focused visual idea"))).toBe(true);
    expect(plan.shots.some((shot) => shot.prompt.includes("rider enters the desert"))).toBe(true);
    expect(plan.shots.some((shot) => shot.prompt.includes("storm arrives"))).toBe(true);
    expect(plan.shots.some((shot) => shot.prompt.includes("sunrise breaks over the mountains"))).toBe(true);
  });
});