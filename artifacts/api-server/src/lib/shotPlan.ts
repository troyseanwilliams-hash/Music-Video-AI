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

export interface ShotPlan {
  numClips: number;
  clipDurationSec: number;
  targetOutputDuration: number;
  shots: PlannedShot[];
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

// Mirror of buildSectionPrompt.
function buildPrompt(input: ShotPlanInput, section: ShotSection, bpm: number | null, mood: string | null): string {
  const style = input.style ?? "cinematic";
  const userPrompt = input.prompt || "music video";
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
    `${section.label} section visual treatment`,
    userPrompt,
    "beat-synced cuts, professional music video production, 4K ultra-wide",
  ].filter(Boolean).join(", ");
}

export function planShots(input: ShotPlanInput): ShotPlan {
  const durationSec = input.analysis?.durationSeconds ?? 0;
  const { numClips, clipDurationSec, target } = planCount(input.requestedDuration, durationSec);
  const hasReal = !!(input.analysis?.sections && input.analysis.sections.length > 0);
  const sections = hasReal ? input.analysis!.sections! : fallbackSections(target || durationSec || 60);
  const sorted = [...sections].sort((a, b) => b.energy - a.energy);
  const bpm = input.analysis?.bpm ?? null;
  const mood = input.analysis?.mood ?? null;

  const shots: PlannedShot[] = [];
  for (let i = 0; i < numClips; i++) {
    const s = sorted[i % sorted.length]!;
    shots.push({
      index: i,
      label: s.label,
      startTime: s.startTime,
      energy: Math.round(s.energy * 100) / 100,
      prompt: buildPrompt(input, s, bpm, mood),
    });
  }
  return { numClips, clipDurationSec, targetOutputDuration: target, shots, approximate: !hasReal };
}
