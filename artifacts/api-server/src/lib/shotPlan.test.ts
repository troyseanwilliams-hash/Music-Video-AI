import { describe, expect, it } from "vitest";
import {
  applyApprovedScenePrompts,
  numberedVideoScriptIssue,
  parseNumberedImagePackScript,
  hasStrictUniqueSourcePlan,
  planImagePackScenes,
  planShots,
  shotPlanFingerprint,
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
  it("maps an exact numbered creative script one-to-one onto video scenes", () => {
    const prompt = [
      "1. Dawn over a windswept prairie.",
      "2. A pilot reaches for a bright red aircraft.",
      "3. The aircraft rises into a golden sky.",
    ].join("\n");
    const plan = planShots({
      prompt,
      style: "cinematic",
      requestedDuration: "30",
      generationMode: "montage",
    });

    expect(numberedVideoScriptIssue(prompt, plan.numClips)).toBeNull();
    expect(plan.shots.map((shot) => shot.description)).toEqual([
      "Establishing world — Dawn over a windswept prairie.",
      "Hero subject — A pilot reaches for a bright red aircraft.",
      "Kinetic motion — The aircraft rises into a golden sky.",
    ]);
    expect(plan.shots[0]!.prompt).not.toContain("pilot reaches");
    expect(plan.shots[1]!.prompt).not.toContain("golden sky");
  });

  it("maps numbered scripts to clean chronological Narrative Story scenes", () => {
    const prompt = [
      "1. A pilot discovers the open sky.",
      "2. The pilot crosses a stormy ocean.",
      "3. The pilot returns home to inspire others.",
    ].join("\n");
    const plan = planShots({
      prompt,
      style: "cinematic",
      requestedDuration: "30",
      generationMode: "narrative",
    });

    expect(plan.shots.map((shot) => shot.description)).toEqual([
      "Opening image — A pilot discovers the open sky.",
      "Turning point — The pilot crosses a stormy ocean.",
      "Final image — The pilot returns home to inspire others.",
    ]);
    expect(plan.shots[0]!.prompt).not.toContain("1.");
    expect(plan.shots[0]!.prompt).not.toContain("crosses a stormy ocean");
    expect(plan.shots[2]!.prompt).toContain("deliver a clear visual resolution");
    expect(plan.shots[0]!.prompt.indexOf("A pilot discovers the open sky"))
      .toBeLessThan(plan.shots[0]!.prompt.indexOf("Style footnote"));
    expect(plan.shots[0]!.prompt).toMatch(/style footnote: cinematic 35mm film/i);
  });

  it("rejects malformed or count-mismatched numbered video scripts", () => {
    expect(numberedVideoScriptIssue([
      "1. Opening shot.",
      "3. Closing shot.",
    ].join("\n"), 2)).toContain("consecutively");
    expect(numberedVideoScriptIssue([
      "1. Opening shot.",
      "2. Closing shot.",
    ].join("\n"), 3)).toBe(
      "This video needs 3 numbered scenes, but the script contains 2.",
    );
  });

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

describe("approved scene prompts", () => {
  const buildPlan = () => planShots({
    prompt: "A pilot crosses an ocean and reaches a sunrise coast.",
    style: "cinematic",
    requestedDuration: "30",
    generationMode: "narrative",
  });

  it("preserves reviewed prompt edits on the authoritative scene plan", () => {
    const plan = buildPlan();
    const fingerprint = shotPlanFingerprint(plan);
    const approved = plan.shots.map((shot) => ({
      index: shot.index,
      prompt: `Reviewed image prompt ${shot.index + 1}`,
    }));

    const result = applyApprovedScenePrompts(plan, approved, fingerprint);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.shots.map((shot) => shot.prompt)).toEqual(
        approved.map((item) => item.prompt),
      );
      expect(result.plan.timeline).toEqual(plan.timeline);
    }
  });

  it("rejects reviewed prompts when the authoritative plan changed", () => {
    const original = buildPlan();
    const changed = planShots({
      prompt: "A pilot crosses an ocean and reaches a sunrise coast.",
      style: "vintage",
      requestedDuration: "30",
      generationMode: "narrative",
    });
    const result = applyApprovedScenePrompts(
      changed,
      original.shots.map((shot) => ({ index: shot.index, prompt: shot.prompt })),
      shotPlanFingerprint(original),
    );

    expect(result).toMatchObject({ ok: false, code: "APPROVED_PROMPTS_STALE" });
  });

  it("rejects reordered, empty, duplicate, and count-mismatched prompt sets", () => {
    const plan = buildPlan();
    const fingerprint = shotPlanFingerprint(plan);
    const valid = plan.shots.map((shot) => ({ index: shot.index, prompt: shot.prompt }));

    expect(applyApprovedScenePrompts(
      plan,
      [{ ...valid[0]!, index: 1 }, valid[1]!, valid[2]!],
      fingerprint,
    )).toMatchObject({ ok: false, code: "APPROVED_PROMPTS_ORDER_INVALID" });
    expect(applyApprovedScenePrompts(
      plan,
      [{ ...valid[0]!, prompt: " " }, valid[1]!, valid[2]!],
      fingerprint,
    )).toMatchObject({ ok: false, code: "APPROVED_PROMPTS_EMPTY" });
    expect(applyApprovedScenePrompts(
      plan,
      [{ ...valid[0]!, prompt: "same" }, { ...valid[1]!, prompt: "SAME" }, valid[2]!],
      fingerprint,
    )).toMatchObject({ ok: false, code: "APPROVED_PROMPTS_DUPLICATE" });
    expect(applyApprovedScenePrompts(
      plan,
      valid.slice(0, 2),
      fingerprint,
    )).toMatchObject({ ok: false, code: "APPROVED_PROMPTS_COUNT_MISMATCH" });
  });

  it("keeps legacy submissions without reviewed prompts compatible", () => {
    const plan = buildPlan();
    expect(applyApprovedScenePrompts(plan, undefined, undefined)).toEqual({
      ok: true,
      plan,
    });
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
  it("keeps generated image prompts concise and refers to an attached character image", () => {
    const plan = planShots({
      prompt: "A pilot prepares a plane. Then the pilot flies through a storm. Finally the pilot lands at sunrise.",
      character: "person",
      hasCharacterReference: true,
      generationMode: "narrative",
      requestedDuration: "30",
    });

    expect(plan.shots.every((shot) => shot.prompt.length <= 600)).toBe(true);
    expect(plan.shots.filter((shot) => shot.usesCharacterReference).every((shot) =>
      shot.prompt.includes("attached reference image")
      && !shot.prompt.includes("featuring person")
    )).toBe(true);
  });

  it("replaces a named subject with the attached character reference", () => {
    const plan = planShots({
      prompt: "Amelia Earhart prepares her aircraft. Amelia Earhart takes flight over the ocean. The empty runway waits at dusk.",
      hasCharacterReference: true,
      generationMode: "narrative",
      requestedDuration: "30",
    });

    expect(plan.shots[0]).toMatchObject({ usesCharacterReference: true });
    expect(plan.shots[0]!.prompt).toContain("attached reference image");
    expect(plan.shots[0]!.prompt).not.toMatch(/Amelia Earhart/i);
    expect(plan.shots[0]!.description).not.toMatch(/Amelia Earhart/i);
    expect(plan.shots[2]).toMatchObject({ usesCharacterReference: false });
  });

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

  it("does not apply a character reference to generic narrative beats", () => {
    const plan = planShots({
      prompt: "A quiet morning begins. Then rain covers the empty rooftops. Finally the city lights fade into the night.",
      hasCharacterReference: true,
      generationMode: "narrative",
      requestedDuration: "30",
    });

    expect(plan.shots.every((shot) => shot.usesCharacterReference === false)).toBe(true);
    expect(plan.shots.every((shot) => !shot.prompt.includes("attached reference image"))).toBe(true);
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