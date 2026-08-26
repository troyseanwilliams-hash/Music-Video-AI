// Self-contained shot planner for the pre-render storyboard preview. MIRRORS the
// worker's buildGenerationPlan + buildSectionPrompt (artifacts/worker/src/lib/
// jobProcessor.ts) so the preview matches what will actually render. Keep in sync
// if that logic changes. Pure functions, no heavy deps — safe to import in routes.
// No credits are charged and nothing is rendered by this module.

const MAX_FULL_SECONDS = 600;

const STYLE_PROMPTS: Record<string, string> = {
  realistic:
    "photorealistic cinematography, real performers, professional film lighting, shallow depth of field",
  anime: "anime art style, expressive characters, vibrant cel shading, dynamic speed lines",
  cinematic:
    "cinematic 35mm film, anamorphic bokeh, dramatic chiaroscuro lighting, movie-grade color grade",
  abstract: "abstract geometric visuals, fluid particle simulations, fractals, morphing shapes",
  neon: "neon cyberpunk, glowing signs, rain-slicked streets, vivid purples and electric blues",
  vintage: "super-8 film grain, warm analog tones, light leaks, retro 70s aesthetic",
  fantasy: "high fantasy, magical particle effects, ethereal mist, enchanted landscapes",
  documentary:
    "handheld documentary, natural light, authentic street aesthetic, real-world textures",
};

export interface ShotSection {
  startTime: number;
  endTime: number;
  label: string;
  energy: number;
}

export interface ShotPlanInput {
  prompt?: string | null;
  style?: string | null;
  character?: string | null;
  requestedDuration?: string | null;
  generationMode?: GenerationMode | null;
  analysis?: {
    bpm?: number | null;
    mood?: string | null;
    durationSeconds?: number | null;
    sections?: ShotSection[] | null;
  } | null;
}

export type GenerationMode = "montage" | "narrative";

export interface PlannedShot {
  index: number;
  label: string;
  description: string;
  startTime: number;
  energy: number;
  usesCharacterReference: boolean;
  prompt: string;
}

export interface MontageTimelineEntry {
  index: number;
  visualIndex: number;
  startTime: number;
  duration: number;
  label: string;
  energy: number;
}

export interface ShotPlan {
  generationMode: GenerationMode;
  numClips: number;
  clipDurationSec: number;
  targetOutputDuration: number;
  shots: PlannedShot[];
  timeline: MontageTimelineEntry[];
  timelineSceneCount: number;
  reuseCount: number;
  approximate: boolean; // true when real audio analysis wasn't available
}

// A reasonable section list when real analysis isn't available yet, so the
// preview can still show the shape of the plan.
const FALLBACK_LABELS = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Verse", "Bridge", "Chorus", "Outro"];
function fallbackSections(durationSec: number): ShotSection[] {
  const n = FALLBACK_LABELS.length;
  const seg = Math.max(1, durationSec / n);
  const energyShape = [0.35, 0.55, 0.7, 0.9, 0.6, 0.75, 0.95, 0.4];
  return Array.from({ length: n }, (_, i) => ({
    startTime: Math.round(i * seg),
    endTime: Math.round((i + 1) * seg),
    label: FALLBACK_LABELS[i]!,
    energy: energyShape[i]!,
  }));
}

// Mirror of the worker clip-count math for each generation mode.
function planCount(
  requestedDuration: string | null | undefined,
  durationSec: number,
  generationMode: GenerationMode,
): {
  numClips: number;
  clipDurationSec: number;
  target: number;
} {
  const dur = requestedDuration ?? "full";
  if (generationMode === "narrative") {
    const target = dur === "full"
      ? Math.min(durationSec > 0 ? durationSec : MAX_FULL_SECONDS, MAX_FULL_SECONDS)
      : Math.max(1, parseInt(dur, 10) || 10);
    const clipDurationSec = target <= 5 ? 5 : 10;
    return {
      numClips: Math.max(1, Math.ceil(target / clipDurationSec)),
      clipDurationSec,
      target,
    };
  }
  if (dur === "full") {
    const capped = Math.min(durationSec > 0 ? durationSec : MAX_FULL_SECONDS, MAX_FULL_SECONDS);
    return { numClips: Math.max(1, Math.min(60, Math.ceil(capped / 10))), clipDurationSec: 10, target: capped };
  }
  const durSec = parseInt(dur, 10);
  const clipDurationSec = durSec <= 5 ? 5 : 10;
  const numClips = Math.max(1, Math.min(60, Math.ceil(durSec / clipDurationSec)));
  return { numClips, clipDurationSec, target: durSec };
}

const MONTAGE_ROLES = [
  "establishing world",
  "hero subject",
  "kinetic motion",
  "environment detail",
  "texture and atmosphere",
  "high-energy visual",
  "intimate close-up",
  "wide-scale spectacle",
  "symbolic motif",
  "closing callback",
];

const NARRATIVE_BEATS = [
  "opening image",
  "inciting moment",
  "rising action",
  "escalation",
  "turning point",
  "climax",
  "resolution",
  "final image",
];

const CHARACTER_FOCUS_TERMS = /\b(?:character|person|people|human|woman|man|girl|boy|child|baby|figure|silhouette|singer|musician|performer|dancer|rider|driver|runner|walker|traveler|traveller|protagonist|hero|heroine|artist|actor|actress|model|subject|face|portrait|couple|family|mother|father|friend|soldier|detective|pilot|he|she|they|him|her|them|his|hers|their)\b/i;
const ENVIRONMENT_FOCUS_TERMS = /\b(?:landscape|skyline|cityscape|mountain|forest|ocean|sea|river|lake|desert|road|street|building|architecture|room|interior|exterior|station|airport|vehicle|car|train|plane|ship|object|detail|texture|atmosphere|weather|storm|rain|cloud|sunrise|sunset|moon|stars|light|shadow)\b/i;
const CHARACTER_MONTAGE_ROLES = new Set(["hero subject", "kinetic motion", "intimate close-up", "high-energy visual", "closing callback"]);
const CHARACTER_NARRATIVE_BEATS = new Set([
  "inciting moment",
  "rising action",
  "escalation",
  "turning point",
  "climax",
  "resolution",
]);

function narrativeBeat(index: number, count: number): string {
  if (count <= 1) return "complete story moment";
  const position = index / (count - 1);
  const beatIndex = Math.min(
    NARRATIVE_BEATS.length - 1,
    Math.floor(position * NARRATIVE_BEATS.length),
  );
  return NARRATIVE_BEATS[beatIndex]!;
}

function sceneDescription(role: string, concept: string): string {
  const normalized = concept.replace(/\s+/g, " ").trim();
  const shortened = normalized.length > 180
    ? `${normalized.slice(0, 177).trimEnd()}…`
    : normalized;
  const title = role.charAt(0).toUpperCase() + role.slice(1);
  return `${title} — ${shortened || "cinematic music video imagery"}`;
}

function sceneUsesCharacterReference(input: ShotPlanInput, role: string, concept: string): boolean {
  const currentScene = `${role} ${concept}`;
  if (CHARACTER_FOCUS_TERMS.test(currentScene)) return true;
  if (ENVIRONMENT_FOCUS_TERMS.test(currentScene)) return false;
  if (!input.character || input.character === "none") return false;
  return CHARACTER_MONTAGE_ROLES.has(role) || CHARACTER_NARRATIVE_BEATS.has(role);
}

function promptConcepts(prompt: string): string[] {
  const normalized = prompt.replace(/\s+/g, " ").trim() || "cinematic music video imagery";
  let parts = normalized
    .split(/(?:[.!?;]+\s*|\n+|,\s+(?=(?:then|next|while|as|before|after|finally)\b))/i)
    .map((part) => part.trim().replace(/^[,:\-\s]+|[,:\-\s]+$/g, ""))
    .filter(Boolean);

  if (parts.length === 1) {
    const clauses = normalized
      .split(/\s+(?:then|and then|before|after|while|finally)\s+/i)
      .map((part) => part.trim().replace(/^[,:\-\s]+|[,:\-\s]+$/g, ""))
      .filter(Boolean);
    if (clauses.length > 1) parts = clauses;
  }

  return parts;
}

export interface NumberedImagePackScript {
  seriesDirection: string;
  scenes: string[];
}

const NUMBERED_SCENE_LINE =
  /^\s*(?:scene\s+)?(\d{1,2})\s*(?:(?:[.):])\s*|\s+)(?:\(\s*(?:\d+(?:\.\d+)?s?|\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(?:\d+(?:\.\d+)?s?|\d{1,2}:\d{2}(?::\d{2})?)\s*\)\s*[:\-]?\s*)?(.+?)\s*$/i;

export function hasNumberedImagePackScript(prompt: string): boolean {
  return prompt
    .split(/\r?\n/)
    .some((line) => line.match(NUMBERED_SCENE_LINE)?.[1] === "1");
}

export function parseNumberedImagePackScript(prompt: string): NumberedImagePackScript | null {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstSceneIndex = lines.findIndex((line) => {
    const match = line.match(NUMBERED_SCENE_LINE);
    return match?.[1] === "1";
  });
  if (firstSceneIndex < 0) return null;

  const scenes: string[] = [];
  let expectedNumber = 1;
  for (const line of lines.slice(firstSceneIndex)) {
    const match = line.match(NUMBERED_SCENE_LINE);
    if (!match) return null;
    const sceneNumber = Number(match[1]);
    if (sceneNumber !== expectedNumber || !match[2]?.trim()) return null;
    scenes.push(match[2].trim());
    expectedNumber += 1;
  }
  if (scenes.length === 0) return null;

  return {
    seriesDirection: lines.slice(0, firstSceneIndex).join(" ").trim(),
    scenes,
  };
}

function splitPromptIntoConcepts(prompt: string, count: number): string[] {
  let parts = promptConcepts(prompt);

  if (parts.length > count) {
    parts = Array.from({ length: count }, (_, index) => {
      const from = Math.floor((index * parts.length) / count);
      const to = Math.floor(((index + 1) * parts.length) / count);
      return parts.slice(from, Math.max(from + 1, to)).join(", ");
    });
  }

  return Array.from({ length: count }, (_, index) => parts[index % parts.length]!);
}

function representativeSections(sections: ShotSection[], count: number): ShotSection[] {
  const chronological = [...sections].sort((a, b) => a.startTime - b.startTime);
  if (count <= 1) return [chronological[0]!];
  return Array.from({ length: count }, (_, index) => {
    const position = Math.round((index / (count - 1)) * (chronological.length - 1));
    return chronological[position]!;
  });
}

function sectionAtTime(sections: ShotSection[], time: number): ShotSection {
  const chronological = [...sections].sort((a, b) => a.startTime - b.startTime);
  return chronological.find((section) => time >= section.startTime && time < section.endTime)
    ?? chronological.reduce((closest, section) =>
      Math.abs(section.startTime - time) < Math.abs(closest.startTime - time) ? section : closest,
    chronological[0]!);
}

function buildMontageTimeline(
  shots: PlannedShot[],
  sections: ShotSection[],
  targetDuration: number,
  slotDuration: number,
): MontageTimelineEntry[] {
  if (shots.length === 0 || targetDuration <= 0) return [];
  const sceneCount = Math.max(1, Math.ceil(targetDuration / slotDuration));
  const usage = new Array(shots.length).fill(0) as number[];
  let previousVisual = -1;

  return Array.from({ length: sceneCount }, (_, index) => {
    const startTime = index * slotDuration;
    const duration = Math.min(slotDuration, targetDuration - startTime);
    const section = sectionAtTime(sections, startTime + duration / 2);
    const leastUsed = Math.min(...usage);
    const candidates = shots.filter((shot) => usage[shot.index] === leastUsed);
    const selected = candidates
      .map((shot) => ({
        shot,
        score:
          Math.abs(shot.energy - section.energy)
          + (shot.index === previousVisual && shots.length > 1 ? 10 : 0),
      }))
      .sort((a, b) => a.score - b.score || a.shot.index - b.shot.index)[0]!.shot;

    usage[selected.index] += 1;
    previousVisual = selected.index;
    return {
      index,
      visualIndex: selected.index,
      startTime,
      duration,
      label: section.label,
      energy: Math.round(section.energy * 100) / 100,
    };
  });
}

function buildPrompt(
  input: ShotPlanInput,
  section: ShotSection,
  bpm: number | null,
  mood: string | null,
  concept: string,
  montageRole: string,
  usesCharacterReference: boolean,
): string {
  const style = input.style ?? "cinematic";
  const styleDesc = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.cinematic!;
  const energyDesc =
    section.energy > 0.75
      ? "intense dynamic action, explosive motion, vivid dramatic visuals"
      : section.energy > 0.5
        ? "flowing vibrant movement, colorful engaging transitions"
        : "calm atmospheric wide shots, subtle elegant motion";
  const paceDesc =
    (bpm ?? 0) > 140
      ? "rapid-cut editing, high-energy fast motion"
      : (bpm ?? 0) > 100
        ? "upbeat fluid transitions, dynamic movement"
        : "slow atmospheric panning, long smooth dissolves";
  const characterDesc = usesCharacterReference
    ? input.character && input.character !== "none"
      ? `featuring ${input.character}`
      : "featuring the recurring principal subject"
    : "environmental or object-focused scene, no featured character unless required by this current visual idea";
  return [
    styleDesc,
    paceDesc,
    `${mood ?? "energetic"} mood`,
    energyDesc,
    characterDesc,
    `${montageRole} visual motif`,
    `${section.label} section visual treatment`,
    concept,
    "one focused visual idea, no complete storyline or multi-scene sequence inside this clip",
    "beat-synced cuts, professional music video production, 4K ultra-wide",
  ].filter(Boolean).join(", ");
}

function buildNarrativePrompt(
  input: ShotPlanInput,
  section: ShotSection,
  bpm: number | null,
  mood: string | null,
  concept: string,
  beat: string,
  sceneIndex: number,
  sceneCount: number,
  usesCharacterReference: boolean,
): string {
  const style = input.style ?? "cinematic";
  const styleDesc = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.cinematic!;
  const energyDesc =
    section.energy > 0.75
      ? "intense dramatic action and decisive movement"
      : section.energy > 0.5
        ? "purposeful movement with growing dramatic tension"
        : "controlled atmospheric movement with clear emotional focus";
  const paceDesc =
    (bpm ?? 0) > 140
      ? "urgent visual pacing"
      : (bpm ?? 0) > 100
        ? "confident forward momentum"
        : "measured cinematic pacing";
  const characterDesc = usesCharacterReference
    ? input.character && input.character !== "none"
      ? `keep the same ${input.character} identity, face, wardrobe, and physical details established across character-focused scenes`
      : "keep the same principal subject identity, wardrobe, and physical details established across character-focused scenes"
    : "focus on the environment, objects, or atmosphere for this story beat; do not introduce the recurring person unless the current concept explicitly calls for them";
  const continuity = usesCharacterReference
    ? sceneIndex === 0
      ? "establish the recurring subject, world, lighting language, and visual rules for all following scenes"
      : "continue directly from the previous character-focused scene with consistent subject identity, world, wardrobe, lighting language, and screen direction"
    : "continue the established world, lighting language, and screen direction without requiring the recurring person in this scene";
  const ending =
    sceneIndex === sceneCount - 1
      ? "deliver a clear visual resolution that completes the story"
      : "end on an action or composition that naturally leads into the next chronological scene";

  return [
    styleDesc,
    paceDesc,
    `${mood ?? "cinematic"} mood`,
    energyDesc,
    `chronological story scene ${sceneIndex + 1} of ${sceneCount}`,
    `${beat} story beat`,
    `${section.label} music section`,
    concept,
    characterDesc,
    continuity,
    ending,
    "one continuous story scene only, no montage, no flashback, no time jump, no multiple locations inside this clip",
    "professional narrative music video production, cinematic composition, no text or titles",
  ].join(", ");
}

export function planShots(input: ShotPlanInput): ShotPlan {
  const generationMode: GenerationMode =
    input.generationMode === "narrative" ? "narrative" : "montage";
  const durationSec = input.analysis?.durationSeconds ?? 0;
  const { numClips, clipDurationSec, target } = planCount(
    input.requestedDuration,
    durationSec,
    generationMode,
  );
  const hasReal = !!(input.analysis?.sections && input.analysis.sections.length > 0);
  const sections = hasReal ? input.analysis!.sections! : fallbackSections(target || durationSec || 60);
  const concepts = splitPromptIntoConcepts(input.prompt || "music video", numClips);
  const orderedStoryConcepts = promptConcepts(input.prompt || "music video");
  const bpm = input.analysis?.bpm ?? null;
  const mood = input.analysis?.mood ?? null;

  if (generationMode === "narrative") {
    const shots = Array.from({ length: numClips }, (_, index) => {
      const startTime = index * clipDurationSec;
      const duration = Math.min(clipDurationSec, target - startTime);
      const section = sectionAtTime(sections, startTime + Math.max(0, duration) / 2);
      const beat = narrativeBeat(index, numClips);
      const conceptIndex = Math.min(
        orderedStoryConcepts.length - 1,
        Math.floor((index * orderedStoryConcepts.length) / numClips),
      );
      const concept = orderedStoryConcepts[conceptIndex]!;
      const usesCharacterReference = sceneUsesCharacterReference(input, beat, concept);
      return {
        index,
        label: beat,
        description: sceneDescription(beat, concept),
        startTime,
        energy: Math.round(section.energy * 100) / 100,
        usesCharacterReference,
        prompt: buildNarrativePrompt(
          input,
          section,
          bpm,
          mood,
          concept,
          beat,
          index,
          numClips,
          usesCharacterReference,
        ),
      };
    });
    const timeline = shots.map((shot, index) => {
      const duration = Math.min(clipDurationSec, target - shot.startTime);
      const section = sectionAtTime(sections, shot.startTime + Math.max(0, duration) / 2);
      return {
        index,
        visualIndex: index,
        startTime: shot.startTime,
        duration,
        label: shot.label,
        energy: Math.round(section.energy * 100) / 100,
      };
    });
    return {
      generationMode,
      numClips,
      clipDurationSec,
      targetOutputDuration: target,
      shots,
      timeline,
      timelineSceneCount: timeline.length,
      reuseCount: 0,
      approximate: !hasReal,
    };
  }

  const motifSections = representativeSections(sections, numClips);
  const shots: PlannedShot[] = [];
  for (let i = 0; i < numClips; i++) {
    const s = motifSections[i]!;
    const role = MONTAGE_ROLES[i % MONTAGE_ROLES.length]!;
    const concept = concepts[i]!;
    const usesCharacterReference = sceneUsesCharacterReference(input, role, concept);
    shots.push({
      index: i,
      label: role,
      description: sceneDescription(role, concept),
      startTime: s.startTime,
      energy: Math.round(s.energy * 100) / 100,
      usesCharacterReference,
      prompt: buildPrompt(input, s, bpm, mood, concept, role, usesCharacterReference),
    });
  }
  const timeline = buildMontageTimeline(shots, sections, target, clipDurationSec);
  return {
    generationMode,
    numClips,
    clipDurationSec,
    targetOutputDuration: target,
    shots,
    timeline,
    timelineSceneCount: timeline.length,
    reuseCount: Math.max(0, timeline.length - numClips),
    approximate: !hasReal,
  };
}

export function planImagePackScenes(input: {
  prompt: string;
  style?: string | null;
  imageCount: number;
  hasCharacterReference: boolean;
}): PlannedShot[] {
  const imageCount = Math.max(1, Math.min(30, Math.round(input.imageCount)));
  const numberedScript = parseNumberedImagePackScript(input.prompt);
  if (numberedScript && numberedScript.scenes.length === imageCount) {
    const planInput: ShotPlanInput = {
      prompt: input.prompt,
      style: input.style,
      character: input.hasCharacterReference ? "recurring reference character" : "recurring principal subject",
      generationMode: "narrative",
    };
    const usesReference = numberedScript.scenes.map((concept, index) =>
      sceneUsesCharacterReference(planInput, narrativeBeat(index, imageCount), concept)
    );
    const firstCharacterSceneIndex = usesReference.findIndex(Boolean);
    const style = input.style ?? "cinematic";
    const styleDesc = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.cinematic!;

    return numberedScript.scenes.map((concept, index) => {
      const usesCharacterReference = usesReference[index]!;
      const characterContinuity = usesCharacterReference
        ? input.hasCharacterReference
          ? "match the uploaded character reference exactly: same identity, face, age, hair, wardrobe, and physical details"
          : index === firstCharacterSceneIndex
            ? "establish the recurring principal character clearly; this image becomes the identity and wardrobe reference for later character scenes"
            : "match the established principal character reference exactly: same identity, face, age, hair, wardrobe, and physical details"
        : "focus only on this scene's environment, objects, or atmosphere; do not add the recurring character unless explicitly requested";
      const seriesDirection = numberedScript.seriesDirection
        ? `series-wide visual direction: ${numberedScript.seriesDirection}`
        : "keep one cohesive visual world, period, palette, lighting language, and camera language across the entire image pack";

      return {
        index,
        label: `scene ${index + 1}`,
        description: `Scene ${index + 1} — ${concept}`,
        startTime: index * 10,
        energy: 0.6,
        usesCharacterReference,
        prompt: [
          styleDesc,
          seriesDirection,
          `strict numbered script scene ${index + 1} of ${imageCount}`,
          `show exactly this scene and no other script beat: ${concept}`,
          characterContinuity,
          index === imageCount - 1
            ? "compose this as the final chronological image"
            : "preserve chronological continuity for the next image without depicting the next event",
          "one still composition, one moment, one setting, and one camera view",
          "no collage, split screen, panels, storyboard, text, captions, or multiple moments",
        ].join(", "),
      };
    });
  }

  const durationSeconds = imageCount * 10;
  return planShots({
    prompt: input.prompt,
    style: input.style,
    character: input.hasCharacterReference ? "recurring reference character" : null,
    requestedDuration: String(durationSeconds),
    generationMode: "narrative",
    analysis: {
      durationSeconds,
      sections: [{
        startTime: 0,
        endTime: durationSeconds,
        label: "image pack",
        energy: 0.6,
      }],
    },
  }).shots.slice(0, imageCount);
}
