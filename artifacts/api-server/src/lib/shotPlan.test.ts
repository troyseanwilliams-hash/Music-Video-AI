import { describe, expect, it } from "vitest";
import {
  parseNumberedImagePackScript,
  hasStrictUniqueSourcePlan,
  planImagePackScenes,
  planShots,
} from "./shotPlan.js";

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
  it("uses eighteen unique paid visuals for a three-minute track", () => {
    const plan = planShots({
      prompt: "A rider enters the desert. Then a storm arrives. Finally sunrise breaks over the mountains.",
      style: "cinematic",
      requestedDuration: "full",
      analysis: THREE_MINUTE_ANALYSIS,
    });

    expect(plan.numClips).toBe(18);
    expect(plan.shots).toHaveLength(18);
    expect(plan.timeline).toHaveLength(18);
    expect(plan.timelineSceneCount).toBe(18);
    expect(plan.reuseCount).toBe(0);
    expect(plan.timeline.reduce((sum, scene) => sum + scene.duration, 0)).toBe(180);
    expect(plan.timeline.every((scene) => scene.duration <= 10)).toBe(true);
  });

  it("maps every montage timeline segment to its matching distinct visual", () => {
    const plan = planShots({
      prompt: "Neon city lights and a dancer moving through rain",
      style: "neon",
      requestedDuration: "full",
      analysis: THREE_MINUTE_ANALYSIS,
    });

    expect(plan.timeline.map((scene) => scene.visualIndex)).toEqual(
      Array.from({ length: plan.numClips }, (_, index) => index),
    );
    expect(hasStrictUniqueSourcePlan(plan)).toBe(true);
  });

  it("rejects a plan whose source image is assigned to more than one segment", () => {
    const plan = planShots({
      prompt: "Neon city lights and a dancer moving through rain",
      style: "neon",
      requestedDuration: "30",
    });
    plan.timeline[1]!.visualIndex = 0;

    expect(hasStrictUniqueSourcePlan(plan)).toBe(false);
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

describe("planImagePackScenes", () => {
  it("creates one scene per requested image and selectively applies the character reference", () => {
    const scenes = planImagePackScenes({
      prompt: "A woman steps off a train. Then an empty train station waits in the rain. Finally sunrise fills the city skyline.",
      style: "cinematic",
      imageCount: 3,
      hasCharacterReference: true,
    });

    expect(scenes).toHaveLength(3);
    expect(scenes.find((scene) => scene.description.includes("woman steps off a train")))
      .toMatchObject({ usesCharacterReference: true });
    expect(scenes.find((scene) => scene.description.includes("empty train station")))
      .toMatchObject({ usesCharacterReference: false });
    expect(scenes.find((scene) => scene.description.includes("sunrise fills the city skyline")))
      .toMatchObject({ usesCharacterReference: false });
  });

  it("maps each numbered script line to exactly one ordered scene", () => {
    const prompt = [
      "Consistent mid-40s man in a dark suit. Moody 1970s grain, rain, and fog.",
      "1 (0-18s): Man walks toward the rainy airport terminal.",
      "2 (18-36s): He pays cash at the ticket counter.",
      "3 (36-54s): Empty cabin with a black tie on the seat.",
    ].join("\n");
    const parsed = parseNumberedImagePackScript(prompt);
    const scenes = planImagePackScenes({
      prompt,
      style: "vintage",
      imageCount: 3,
      hasCharacterReference: false,
    });

    expect(parsed).toEqual({
      seriesDirection: "Consistent mid-40s man in a dark suit. Moody 1970s grain, rain, and fog.",
      scenes: [
        "Man walks toward the rainy airport terminal.",
        "He pays cash at the ticket counter.",
        "Empty cabin with a black tie on the seat.",
      ],
    });
    expect(scenes.map((scene) => scene.description)).toEqual([
      "Scene 1 — Man walks toward the rainy airport terminal.",
      "Scene 2 — He pays cash at the ticket counter.",
      "Scene 3 — Empty cabin with a black tie on the seat.",
    ]);
    expect(scenes[0]!.prompt).toContain("show exactly this scene and no other script beat");
    expect(scenes[0]!.prompt).not.toContain("He pays cash");
    expect(scenes[1]!.prompt).not.toContain("Empty cabin");
    expect(scenes[0]).toMatchObject({ usesCharacterReference: true });
    expect(scenes[1]).toMatchObject({ usesCharacterReference: true });
    expect(scenes[2]).toMatchObject({ usesCharacterReference: false });
    expect(scenes[0]!.prompt).toContain("becomes the identity and wardrobe reference");
    expect(scenes[1]!.prompt).toContain("match the established principal character reference exactly");
  });

  it("rejects gaps in a numbered scene list instead of silently reordering it", () => {
    expect(parseNumberedImagePackScript([
      "Keep one consistent character.",
      "1. Opening scene.",
      "3. Final scene.",
    ].join("\n"))).toBeNull();
  });

  it("accepts standard minute-second timecodes and rejects unnumbered lines after scene one", () => {
    expect(parseNumberedImagePackScript([
      "1970s visual direction.",
      "1 (00:00–00:18): Opening at the airport.",
      "2 (00:18–00:36): The man pays cash.",
    ].join("\n"))?.scenes).toEqual([
      "Opening at the airport.",
      "The man pays cash.",
    ]);
    expect(parseNumberedImagePackScript([
      "1. Opening at the airport.",
      "This accidental line must not be silently dropped.",
      "2. The man pays cash.",
    ].join("\n"))).toBeNull();
  });
});

describe("planShots narrative planning", () => {
  it("only marks character-focused story scenes for the character reference", () => {
    const plan = planShots({
      prompt: "A woman steps off a train. Then an empty train station waits in the rain. Finally sunrise fills the city skyline.",
      generationMode: "narrative",
      requestedDuration: "30",
    });

    expect(plan.shots.find((shot) => shot.description.includes("woman steps off a train")))
      .toMatchObject({ usesCharacterReference: true });
    expect(plan.shots.find((shot) => shot.description.includes("empty train station")))
      .toMatchObject({ usesCharacterReference: false });
    expect(plan.shots.find((shot) => shot.description.includes("sunrise fills the city skyline")))
      .toMatchObject({ usesCharacterReference: false });
  });

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

  it("scales every ten-minute full track to sixty unique paid scenes", () => {
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
    expect(montage.numClips).toBe(60);
    expect(montage.timelineSceneCount).toBe(60);
    expect(montage.reuseCount).toBe(0);
    expect(hasStrictUniqueSourcePlan(narrative)).toBe(true);
    expect(hasStrictUniqueSourcePlan(montage)).toBe(true);
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