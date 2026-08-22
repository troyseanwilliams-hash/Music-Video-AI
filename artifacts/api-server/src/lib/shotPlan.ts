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
  analysis?: {
    bpm?: number | null;
    mood?: string | null;
    durationSeconds?: number | null;
    sections?: ShotSection[] | null;
  } | null;
}

export interface PlannedShot {
  index: number;
  label: string;
  startTime: number;
  energy: number;
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

// Mirror of buildGenerationPlan's clip-count math.
function planCount(requestedDuration: string | null | undefined, durationSec: number): {
  numClips: number;
  clipDurationSec: number;
  target: number;
} {
  const dur = requestedDuration ?? "full";
  if (dur === "full") {
    const capped = Math.min(durationSec > 0 ? durationSec : MAX_FULL_SECONDS, MAX_FULL_SECONDS);
    return { numClips: Math.max(3, Math.min(20, Math.ceil(capped / 30))), clipDurationSec: 10, target: capped };
  }
  const durSec = parseInt(dur, 10);
  const clipDurationSec = durSec <= 5 ? 5 : 10;
  const numClips = durSec > 120
    ? Math.min(30, Math.ceil(durSec / 20))
    : Math.max(1, Math.ceil(durSec / clipDurationSec));
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

function splitPromptIntoConcepts(prompt: string, count: number): string[] {
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
  const characterDesc = input.character && input.character !== "none" ? `featuring ${input.character}` : "";
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

export function planShots(input: ShotPlanInput): ShotPlan {
  const durationSec = input.analysis?.durationSeconds ?? 0;
  const { numClips, clipDurationSec, target } = planCount(input.requestedDuration, durationSec);
  const hasReal = !!(input.analysis?.sections && input.analysis.sections.length > 0);
  const sections = hasReal ? input.analysis!.sections! : fallbackSections(target || durationSec || 60);
  const motifSections = representativeSections(sections, numClips);
  const concepts = splitPromptIntoConcepts(input.prompt || "music video", numClips);
  const bpm = input.analysis?.bpm ?? null;
  const mood = input.analysis?.mood ?? null;

  const shots: PlannedShot[] = [];
  for (let i = 0; i < numClips; i++) {
    const s = motifSections[i]!;
    const role = MONTAGE_ROLES[i % MONTAGE_ROLES.length]!;
    shots.push({
      index: i,
      label: role,
      startTime: s.startTime,
      energy: Math.round(s.energy * 100) / 100,
      prompt: buildPrompt(input, s, bpm, mood, concepts[i]!, role),
    });
  }
  const timeline = buildMontageTimeline(shots, sections, target, clipDurationSec);
  return {
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
