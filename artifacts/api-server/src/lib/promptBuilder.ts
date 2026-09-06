// Prompt Builder — turns a plain-English description into a polished, ready-to-use
// prompt for the audio (Soundtrack) or video (Generate) engines. Fetch-based, no
// SDK dependency (mirrors lyricsGen.ts). Uses ANTHROPIC_API_KEY (preferred) or
// OPENAI_API_KEY; falls back to a deterministic template so the flow always works.

import { logger } from "./logger.js";
import { shortenCompletePrompt } from "./promptText.js";
import { sanitizeGeneratedMediaPrompt } from "./promptSafety.js";
import { sceneConceptIncludesCharacter } from "./shotPlan.js";
import {
  containsNamedSubject,
  detectNamedSubject,
  fallbackNamedSubjectDescription,
  replaceNamedSubjectWithDescription,
  replaceNamedSubjectWithReference,
} from "./namedSubject.js";

// ── Shared LLM call ──────────────────────────────────────────────────────────

function anthropicModel(): string {
  return process.env.PROMPT_ANTHROPIC_MODEL ?? process.env.LYRICS_ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
}
function openaiModel(): string {
  return process.env.PROMPT_OPENAI_MODEL ?? process.env.LYRICS_OPENAI_MODEL ?? "gpt-4o-mini";
}

export function promptProviderAvailable(): "anthropic" | "openai" | "template" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "template";
}

// Returns the model's text, or null if no key is set / the call fails.
async function callLLM(system: string, user: string, maxTokens = 700, temperature = 0.9): Promise<{ text: string; source: string } | null> {
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: anthropicModel(),
          max_tokens: maxTokens,
          temperature,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { content?: { text?: string }[] };
      const text = data.content?.map((b) => b.text ?? "").join("").trim();
      if (text) return { text, source: "anthropic" };
    } else if (process.env.OPENAI_API_KEY) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openaiModel(),
          max_tokens: maxTokens,
          temperature,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) return { text, source: "openai" };
    }
  } catch (err) {
    logger.error({ err }, "Prompt Builder LLM call failed — falling back to template");
  }
  return null;
}

// Pull the first {...} JSON object out of an LLM response (handles code fences /
// stray prose around the JSON).
function extractJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

// ── Audio (Soundtrack) prompt + style ────────────────────────────────────────

export interface AudioPromptResult {
  prompt: string;
  genre: string;
  mood: string;
  bpm: number | null;
  tags: string[];
  source: string;
}

const AUDIO_SYSTEM = `You are a seasoned music producer writing prompts for an instrumental AI music generator (Stable Audio style).
Given a short description, craft a rich, specific INSTRUMENTAL music prompt (no lyrics, no vocals) plus structured style metadata.

Write the prompt as one flowing sentence (~40–70 words) that layers:
- genre and sub-genre (be specific — "boom-bap lo-fi", "cinematic post-rock", "deep house", not just "hip hop"),
- 2–4 named lead + supporting instruments (e.g. Rhodes, upright bass, brushed drums, analog pads, plucked koto),
- groove / rhythm feel and dynamics (swung, four-on-the-floor, half-time, building),
- production texture and space (tape saturation, vinyl crackle, wide reverb, sidechain, lo-fi hiss),
- mood and setting the music evokes.
Vary your instrument and adjective choices — don't reuse the same stock words every time. Never mention vocals.

Return ONLY valid JSON, no prose, in exactly this shape:
{"prompt":"...","genre":"...","mood":"...","bpm":90,"tags":["tag1","tag2","tag3","tag4"]}
bpm is an integer 60–160 that fits the genre. tags are 3–6 short lowercase descriptors (genre, mood, key instruments, texture).`;

function templateAudio(description: string): AudioPromptResult {
  const d = description.trim() || "calm ambient background";
  return {
    prompt: `Instrumental ${d}, warm evolving pads, gentle rhythm, rich texture, cinematic atmosphere, no vocals`,
    genre: "cinematic",
    mood: "atmospheric",
    bpm: 90,
    tags: ["instrumental", "cinematic", "atmospheric", "ambient"],
    source: "template",
  };
}

export async function generateAudioPrompt(description: string): Promise<AudioPromptResult> {
  const out = await callLLM(AUDIO_SYSTEM, `Description: ${description}`, 500, 1.0);
  if (out) {
    const parsed = extractJson<Partial<AudioPromptResult>>(out.text);
    if (parsed?.prompt) {
      return {
        prompt: String(parsed.prompt).slice(0, 600),
        genre: String(parsed.genre ?? "cinematic"),
        mood: String(parsed.mood ?? "atmospheric"),
        bpm: typeof parsed.bpm === "number" ? Math.max(40, Math.min(200, Math.round(parsed.bpm))) : null,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t)).slice(0, 6) : [],
        source: out.source,
      };
    }
  }
  return templateAudio(description);
}

// ── Video scene prompt ───────────────────────────────────────────────────────

export interface VideoPromptResult {
  prompt: string;
  negativePrompt: string;
  source: string;
}

const DEFAULT_NEGATIVE = "text, watermark, logo, subtitles, distorted face, extra limbs, extra fingers, low quality, blur, jitter, warping";

const VIDEO_SYSTEM = `You are a cinematographer writing prompts for an AI video generator (Kling / Runway).
Given a description, write ONE vivid, cinematic, engine-ready shot prompt. Always begin with the concrete scene subject, action, and setting so the essential scene survives prompt truncation. Put lighting, lens/camera movement, color grade, and film-style descriptors afterward. Keep it under ~90 words, photorealistic-friendly, no lyrics or on-screen text.
Return ONLY valid JSON in exactly this shape:
{"prompt":"...","negativePrompt":"..."}
negativePrompt lists things to avoid (artifacts, text, distortions).`;

export function ensureVideoSceneDetailFirst(
  description: string,
  generatedPrompt: string,
): string {
  const scene = description.trim() || "A lone figure walks through a neon-lit city at night";
  const generated = generatedPrompt.trim();
  if (!generated) return scene;
  if (generated.toLocaleLowerCase().startsWith(scene.toLocaleLowerCase())) {
    return generated;
  }
  return `${scene.replace(/[.!?]+$/, "")}. ${generated}`.slice(0, 1500);
}

function templateVideo(description: string, style?: string): VideoPromptResult {
  const d = description.trim() || "a lone figure walking through a neon-lit city at night";
  const s = style ? ` ${style} style.` : "";
  return {
    prompt: `${d.replace(/[.!?]+$/, "")}. Volumetric lighting, shallow depth of field, slow elegant camera motion, moody color grade, 35mm film grain, photorealistic.${s}`,
    negativePrompt: DEFAULT_NEGATIVE,
    source: "template",
  };
}

export async function generateVideoPrompt(
  description: string,
  opts?: { style?: string; aspectRatio?: string },
): Promise<VideoPromptResult> {
  const extra: string[] = [`Description: ${description}`];
  if (opts?.style) extra.push(`Preferred style: ${opts.style}.`);
  if (opts?.aspectRatio) extra.push(`Aspect ratio: ${opts.aspectRatio}.`);
  const out = await callLLM(VIDEO_SYSTEM, extra.join(" "), 500);
  if (out) {
    const parsed = extractJson<Partial<VideoPromptResult>>(out.text);
    if (parsed?.prompt) {
      return {
        prompt: ensureVideoSceneDetailFirst(description, String(parsed.prompt)),
        negativePrompt: String(parsed.negativePrompt ?? DEFAULT_NEGATIVE).slice(0, 400),
        source: out.source,
      };
    }
  }
  return templateVideo(description, opts?.style);
}

export const MAX_SCENE_SCRIPT_LENGTH = 12_000;
export const MAX_SCENE_BUILDER_SCENES = 20;
export const MAX_SCENE_IMAGE_PROMPT_LENGTH = 420;

export interface SceneBuilderScene {
  number: number;
  title: string;
  imagePrompt: string;
}

export interface SceneBuilderResult {
  mode: "montage" | "narrative";
  scenes: SceneBuilderScene[];
  script: string;
  sceneCount: number;
  hasReferenceImage: boolean;
  source: string;
}

const NARRATIVE_STORY_SYSTEM = `You are a visual story editor. Turn a plain-language premise into one cohesive story script for an AI music video.
Write one natural-language narrative, not numbered scenes, bullets, camera directions, or a shot list.
Preserve a clear beginning, progression, climax, and ending. Keep recurring characters and the world consistent.
Use provider-neutral, family-safe language. Keep the result under 1,800 characters.
Return ONLY valid JSON in exactly this shape:
{"script":"..."}`;

const SCENE_BUILDER_SYSTEM = `You are a visual story editor. Split a generic story into a chronological list of distinct scenes for an AI image generator.
Return ONLY valid JSON in exactly this shape:
{"scenes":[{"title":"short scene title","imagePrompt":"concise image prompt"}]}

Rules:
- Create the requested number of scenes, or 3–12 scenes if no count is provided.
- Every imagePrompt must be 18–35 words, concrete, visual, and self-contained: start with the scene's subject/action and setting, then add lighting, mood, and composition.
- Each imagePrompt must describe one still image, one moment, and one location. Do not write video directions, dialogue, narration, camera movement, captions, or abstract plot summaries.
- Keep every imagePrompt concise enough to combine all numbered scenes into a 12,000-character creative prompt.
- Preserve chronological story progression and make each scene materially different from the previous one.
- Describe the supplied story beat first. Keep any aesthetic or style wording brief and place it at the end as a "style footnote"; never let style replace the scene description.
- Write prompts that are likely to pass standard image and video safety checks. Keep minors fully clothed, supervised, safe, and free of intimate physical contact, danger, distress, weapons, or adult themes.
- Replace nudity or adult intimate material with fully clothed, family-friendly, non-romantic imagery; replace graphic injury, gore, self-harm, or suicide with non-graphic tension, compassionate support, or a safe aftermath.
- Preserve the story's emotional intent when making a safety adjustment, but never include ambiguous sensitive interactions that could cancel downstream image or video generation.
- Use plain provider-neutral language. Do not mention any image or video provider.
- If a reference image will be attached, use it only in scenes whose story beat contains or clearly depicts that character. In those character scenes, do not describe the character's face, hair, clothing, identity, age, or other appearance; write "use the attached reference image for the character" instead.
- Never mention or use the attached reference image in environment-only, object-only, or other scenes where the character does not appear.
- If no reference image will be attached, include only the minimum visible character traits needed for that scene.
- The supplied story beat is authoritative. Never replace its subject, action, location, or cast with a different person, role, or alternate character. Do not add a second person, new named character, or supporting role unless that beat explicitly contains them.
- Environment-only beats must remain environment-only, even if a previous or later scene contains a recurring character.
- Preserve the recurring character's stated gender in every character scene. Never change a woman or girl into a man or boy, or a man or boy into a woman or girl, between scenes.
- When a reference image is attached, preserve the character's gender presentation exactly as shown in that reference.

Return no markdown and no extra keys.`;

function compactSceneText(value: unknown, maxLength: number, fallback: string): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  if (normalized.length <= maxLength) return normalized;
  const words = normalized.split(" ");
  let shortened = "";
  for (const word of words) {
    const candidate = shortened ? `${shortened} ${word}` : word;
    if (candidate.length > maxLength) break;
    shortened = candidate;
  }
  return shortened || normalized.slice(0, maxLength).trimEnd();
}

const CHARACTER_MULTIPLICITY_TERMS = /\b(?:two|three|several|multiple|group|crowd|team|couple|family|people|persons|characters|men|women|girls|boys|children|workers|operators|mechanics|searchers)\b/i;

// Role-level checks catch substitutions such as changing a pilot into a
// navigator without rejecting harmless visual wording around the same person.
const CHARACTER_ROLE_GROUPS: Array<[string, RegExp]> = [
  ["pilot", /\b(?:pilot|aviator|flyer|airman|airwoman)\b/i],
  ["navigator", /\bnavigator\b/i],
  ["mechanic", /\bmechanic(?:s)?\b/i],
  ["operator", /\boperator(?:s)?\b/i],
  ["crew", /\bcrew(?:men|members)?\b/i],
  ["searcher", /\b(?:searcher|searchers|search crew|search team)\b/i],
  ["detective", /\bdetective(?:s)?\b/i],
  ["clerk", /\bclerk(?:s)?\b/i],
  ["photographer", /\bphotographer(?:s)?\b/i],
  ["inventor", /\binventor(?:s)?\b/i],
  ["rider", /\brider(?:s)?\b/i],
  ["driver", /\bdriver(?:s)?\b/i],
  ["sailor", /\bsailor(?:s)?\b/i],
  ["captain", /\bcaptain(?:s)?\b/i],
  ["soldier", /\bsoldier(?:s)?\b/i],
  ["doctor", /\bdoctor(?:s)?\b/i],
  ["nurse", /\bnurse(?:s)?\b/i],
  ["teacher", /\bteacher(?:s)?\b/i],
  ["student", /\bstudent(?:s)?\b/i],
];

function characterRoleGroups(value: string): Set<string> {
  return new Set(
    CHARACTER_ROLE_GROUPS
      .filter(([, pattern]) => pattern.test(value))
      .map(([group]) => group),
  );
}

function hasExplicitCharacterConflict(sourceBeat: string, generatedPrompt: string): boolean {
  const sourceHasFemale = /\b(?:female|woman|girl|mother|daughter|sister|wife|heroine|she|her)\b/i.test(sourceBeat);
  const sourceHasMale = /\b(?:male|man|boy|father|son|brother|husband|hero|he|him|his)\b/i.test(sourceBeat);
  const generatedHasFemale = /\b(?:female|woman|girl|mother|daughter|sister|wife|heroine|she|her)\b/i.test(generatedPrompt);
  const generatedHasMale = /\b(?:male|man|boy|father|son|brother|husband|hero|he|him|his)\b/i.test(generatedPrompt);
  if (sourceHasFemale && !sourceHasMale && generatedHasMale && !generatedHasFemale) return true;
  if (sourceHasMale && !sourceHasFemale && generatedHasFemale && !generatedHasMale) return true;

  const sourceRoles = characterRoleGroups(sourceBeat);
  const generatedRoles = characterRoleGroups(generatedPrompt);
  if (generatedRoles.size > 0 && sourceRoles.size === 0) return true;
  if ([...generatedRoles].some((role) => !sourceRoles.has(role))) return true;

  if (
    CHARACTER_MULTIPLICITY_TERMS.test(generatedPrompt)
    && !CHARACTER_MULTIPLICITY_TERMS.test(sourceBeat)
  ) {
    return true;
  }

  // New multi-word proper names are strong evidence that the model invented
  // another person. Named-subject replacement runs before this comparison.
  const properNames = (value: string) =>
    value.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? [];
  const sourceNames = new Set(properNames(sourceBeat).map((name) => name.toLocaleLowerCase()));
  return properNames(generatedPrompt)
    .some((name) => !sourceNames.has(name.toLocaleLowerCase()));
}

export function generatedPromptRespectsStoryBeat(
  sourceBeat: string,
  generatedPrompt: string,
): boolean {
  if (!generatedPrompt.trim()) return false;
  if (!sceneConceptIncludesCharacter(sourceBeat)) return false;
  return !hasExplicitCharacterConflict(sourceBeat, generatedPrompt);
}

function recommendedSceneCount(story: string): number {
  const words = story.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.min(12, Math.round(words / 45) || 3));
}

function splitStoryIntoBeats(story: string, sceneCount: number): string[] {
  const sentences = story
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const parts = sentences.length > 0 ? sentences : [story.trim()];
  return Array.from({ length: sceneCount }, (_, index) => {
    const from = Math.floor((index * parts.length) / sceneCount);
    const to = Math.max(from + 1, Math.floor(((index + 1) * parts.length) / sceneCount));
    return parts.slice(from, to).join(" ") || parts[Math.min(index, parts.length - 1)]!;
  });
}

function sceneScript(scenes: SceneBuilderScene[]): string {
  return scenes.map((scene, index) => `${index + 1}. ${scene.imagePrompt}`).join("\n");
}

export function normalizeSceneBuilderScenes(
  rawScenes: unknown,
  story: string,
  sceneCount: number,
  hasReferenceImage: boolean,
): SceneBuilderScene[] {
  const sourceScenes = Array.isArray(rawScenes) ? rawScenes : [];
  const beats = splitStoryIntoBeats(story, sceneCount);
  const namedSubject = detectNamedSubject(story);
  const maxPromptLength = Math.min(
    MAX_SCENE_IMAGE_PROMPT_LENGTH,
    Math.floor((MAX_SCENE_SCRIPT_LENGTH - sceneCount * 8) / sceneCount),
  );

  return Array.from({ length: sceneCount }, (_, index) => {
    const raw = sourceScenes[index];
    const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const sourceBeat = beats[index]!;
    const usesCharacterReference =
      hasReferenceImage
      && (
        containsNamedSubject(sourceBeat, namedSubject)
        || sceneConceptIncludesCharacter(sourceBeat)
      );
    const beat = hasReferenceImage
      ? replaceNamedSubjectWithReference(sourceBeat, namedSubject)
      : replaceNamedSubjectWithDescription(sourceBeat, namedSubject);
    const fallbackPrompt = usesCharacterReference
      ? `${beat}, use the attached reference image for the character, clear cinematic still composition, style footnote: cinematic`
      : `${beat}, clear subject and setting, expressive lighting and mood, style footnote: cinematic`;
    const generatedPromptWithPossibleReference = shortenCompletePrompt(
      String(record.imagePrompt ?? ""),
      maxPromptLength,
      shortenCompletePrompt(fallbackPrompt, maxPromptLength),
    );
    const generatedPromptWithoutName = replaceNamedSubjectWithReference(
      generatedPromptWithPossibleReference,
      namedSubject,
    );
    const generatedPromptWithoutNameOrReference = hasReferenceImage
      ? generatedPromptWithoutName
      : replaceNamedSubjectWithDescription(generatedPromptWithPossibleReference, namedSubject);
    const cleanedGeneratedPrompt = usesCharacterReference
      ? generatedPromptWithoutNameOrReference
      : generatedPromptWithoutNameOrReference
          .replace(/\b(?:use|match|refer to)\s+the attached reference image[^,.;]*[,.;]?\s*/gi, "")
          .replace(/\s+/g, " ")
          .trim();
    const generatedPrompt = generatedPromptRespectsStoryBeat(
      sourceBeat,
      cleanedGeneratedPrompt,
    )
      ? shortenCompletePrompt(
          `${beat}, ${cleanedGeneratedPrompt}`,
          maxPromptLength,
          fallbackPrompt,
        )
      : fallbackPrompt;
    const unsanitizedImagePrompt = usesCharacterReference && !/attached reference image/i.test(generatedPrompt)
      ? shortenCompletePrompt(
          `Use the attached reference image for the character, ${generatedPrompt}`,
          maxPromptLength,
          fallbackPrompt,
        )
      : generatedPrompt || shortenCompletePrompt(fallbackPrompt, maxPromptLength);
    const imagePrompt = shortenCompletePrompt(
      sanitizeGeneratedMediaPrompt(unsanitizedImagePrompt).prompt,
      maxPromptLength,
      sanitizeGeneratedMediaPrompt(fallbackPrompt).prompt,
    );
    const title = compactSceneText(record.title, 70, `Scene ${index + 1}`);
    return { number: index + 1, title, imagePrompt };
  });
}

function buildFallbackScenePlan(story: string, sceneCount: number, hasReferenceImage: boolean): SceneBuilderResult {
  const scenes = normalizeSceneBuilderScenes([], story, sceneCount, hasReferenceImage);
  return {
    mode: "montage",
    scenes,
    script: sceneScript(scenes),
    sceneCount,
    hasReferenceImage,
    source: "template",
  };
}

async function buildNarrativeStory(story: string): Promise<SceneBuilderResult> {
  const out = await callLLM(
    NARRATIVE_STORY_SYSTEM,
    `Premise:\n${story}`,
    700,
    0.65,
  );
  const parsed = out ? extractJson<{ script?: unknown }>(out.text) : null;
  const fallback = compactSceneText(story, 1_800, "A cohesive visual story unfolds from beginning to end.");
  const script = shortenCompletePrompt(
    sanitizeGeneratedMediaPrompt(String(parsed?.script ?? fallback)).prompt,
    1_800,
    fallback,
  );
  return {
    mode: "narrative",
    scenes: [],
    script,
    sceneCount: 0,
    hasReferenceImage: false,
    source: out?.source ?? "template",
  };
}

export async function buildScenePlan(input: {
  story: string;
  sceneCount?: number;
  hasReferenceImage?: boolean;
  mode?: "montage" | "narrative";
}): Promise<SceneBuilderResult> {
  const story = input.story.trim();
  if (input.mode === "narrative") return buildNarrativeStory(story);
  const sceneCount = Math.max(
    2,
    Math.min(MAX_SCENE_BUILDER_SCENES, Math.round(input.sceneCount ?? recommendedSceneCount(story))),
  );
  const hasReferenceImage = Boolean(input.hasReferenceImage);
  const out = await callLLM(
    SCENE_BUILDER_SYSTEM,
    [
      `Requested scene count: ${input.sceneCount ? sceneCount : "recommend an appropriate count"}.`,
      `Reference image will be attached: ${hasReferenceImage ? "yes" : "no"}.`,
      `Story:\n${story}`,
    ].join("\n"),
    Math.min(1800, 100 + sceneCount * 80),
    0.5,
  );
  const parsed = out ? extractJson<{ scenes?: unknown }>(out.text) : null;
  const scenes = normalizeSceneBuilderScenes(parsed?.scenes, story, sceneCount, hasReferenceImage);
  const script = sceneScript(scenes);
  if (!script || script.length > MAX_SCENE_SCRIPT_LENGTH) {
    return buildFallbackScenePlan(story, sceneCount, hasReferenceImage);
  }
  return {
    mode: "montage",
    scenes,
    script,
    sceneCount,
    hasReferenceImage,
    source: out?.source ?? "template",
  };
}

export interface SubjectReplacementResult {
  script: string;
  characterDescription: string;
  source: string;
}

const SUBJECT_REPLACEMENT_SYSTEM = `You create concise provider-safe visual descriptions for named people or characters in image and video prompts.
Return ONLY valid JSON in exactly this shape:
{"characterDescription":"..."}
The description must be 12–40 words, describe observable appearance, clothing, era, and demeanor, and be usable as a direct replacement inside a visual scene script.
Do not include the supplied name, pronouns that refer back to it, commentary, or claims about an exact likeness. Prefer historically grounded visual traits when the subject is a historical figure.`;

function fallbackCharacterDescription(namedSubject: string): string {
  return fallbackNamedSubjectDescription(namedSubject);
}

function removeSubjectName(value: string, namedSubject: string): string {
  return value
    .replace(new RegExp(namedSubject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function replaceNamedSubjectInScript(
  script: string,
  namedSubject: string,
): Promise<SubjectReplacementResult> {
  const fallback = fallbackCharacterDescription(namedSubject);
  const out = await callLLM(
    SUBJECT_REPLACEMENT_SYSTEM,
    `Named subject: ${namedSubject}\nOriginal script for visual context:\n${script}`,
    220,
    0.4,
  );
  const parsed = out ? extractJson<{ characterDescription?: unknown }>(out.text) : null;
  const modelDescription = typeof parsed?.characterDescription === "string"
    ? removeSubjectName(parsed.characterDescription, namedSubject)
    : "";
  const characterDescription =
    modelDescription.length >= 20 && modelDescription.length <= 320
      ? modelDescription
      : fallback;

  return {
    script: script.replace(
      new RegExp(namedSubject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      characterDescription,
    ),
    characterDescription,
    source: out?.source ?? "template",
  };
}
