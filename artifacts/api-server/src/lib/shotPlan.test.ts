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

describe("planShots narrative planning", () => {
  it("creates eighteen unique chronological scenes for a three-minute story", () => {
    const plan = planShots({
      prompt: "A rider enters the desert. Then a storm arrives. Finally sunrise breaks over the mountains.",
      style: "cinematic",
      generationMode: "narrative",
      requestedDuration: "full",
      analysis: THREE_MINUTE_ANALYSIS,
    });

    expect(plan.generationMode).toBe("narrative");
    expect(plan.numClips).toBe(18);
    expect(plan.shots).toHaveLength(18);
    expect(plan.timeline).toHaveLength(18);
    expect(plan.reuseCount).toBe(0);
    expect(plan.timeline.map((scene) => scene.visualIndex)).toEqual(
      Array.from({ length: 18 }, (_, index) => index),
    );
    expect(new Set(plan.shots.map((shot) => shot.prompt)).size).toBe(18);
    expect(plan.shots[0]!.prompt).toContain("chronological story scene 1 of 18");
    expect(plan.shots[0]!.description).toContain("Opening image — A rider enters the desert");
    expect(plan.shots[0]!.prompt).toContain("rider enters the desert");
    expect(plan.shots[8]!.prompt).toContain("storm arrives");
    expect(plan.shots[8]!.description).toContain("storm arrives");
    expect(plan.shots[17]!.prompt).toContain("sunrise breaks over the mountains");
    expect(plan.shots[17]!.description).toContain("sunrise breaks over the mountains");
    expect(plan.shots[17]!.prompt).not.toContain("rider enters the desert");
    expect(plan.shots[17]!.prompt).toContain("deliver a clear visual resolution");
  });

  it("scales a ten-minute full track to sixty paid scenes without changing Montage", () => {
    const analysis = {
      ...THREE_MINUTE_ANALYSIS,
      durationSeconds: 600,
      sections: [
        { startTime: 0, endTime: 600, label: "full track", energy: 0.7 },
      ],
    };
    const narrative = planShots({
      prompt: "A hero crosses a changing city",
      generationMode: "narrative",
      requestedDuration: "full",
      analysis,
    });
    const montage = planShots({
      prompt: "A hero crosses a changing city",
      generationMode: "montage",
      requestedDuration: "full",
      analysis,
    });

    expect(narrative.numClips).toBe(60);
    expect(narrative.timelineSceneCount).toBe(60);
    expect(narrative.reuseCount).toBe(0);
    expect(montage.numClips).toBe(20);
    expect(montage.timelineSceneCount).toBe(60);
    expect(montage.reuseCount).toBe(40);
  });

  it("uses one five-second scene for a five-second Narrative Story", () => {
    const plan = planShots({
      prompt: "A door opens into daylight",
      generationMode: "narrative",
      requestedDuration: "5",
    });

    expect(plan.numClips).toBe(1);
    expect(plan.clipDurationSec).toBe(5);
    expect(plan.timeline).toEqual([
      expect.objectContaining({ index: 0, visualIndex: 0, duration: 5 }),
    ]);
  });
});