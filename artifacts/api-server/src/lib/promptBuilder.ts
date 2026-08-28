// Prompt Builder — turns a plain-English description into a polished, ready-to-use
// prompt for the audio (Soundtrack) or video (Generate) engines. Fetch-based, no
// SDK dependency (mirrors lyricsGen.ts). Uses ANTHROPIC_API_KEY (preferred) or
// OPENAI_API_KEY; falls back to a deterministic template so the flow always works.

import { logger } from "./logger.js";

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
Given a description, write ONE vivid, cinematic, engine-ready shot prompt: subject, action, setting, lighting, lens/camera move, color grade, and film-style descriptors. Keep it under ~90 words, photorealistic-friendly, no lyrics or on-screen text.
Return ONLY valid JSON in exactly this shape:
{"prompt":"...","negativePrompt":"..."}
negativePrompt lists things to avoid (artifacts, text, distortions).`;

function templateVideo(description: string, style?: string): VideoPromptResult {
  const d = description.trim() || "a lone figure walking through a neon-lit city at night";
  const s = style ? `${style} style, ` : "";
  return {
    prompt: `Cinematic shot, ${s}${d}. Volumetric lighting, shallow depth of field, 35mm film grain, moody color grade, slow elegant camera motion, photorealistic.`,
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
        prompt: String(parsed.prompt).slice(0, 1500),
        negativePrompt: String(parsed.negativePrompt ?? DEFAULT_NEGATIVE).slice(0, 400),
        source: out.source,
      };
    }
  }
  return templateVideo(description, opts?.style);
}

export interface SubjectReplacementResult {
  script: string;
  characterDescription: string;
  source: string;
}

const KNOWN_SUBJECT_DESCRIPTIONS: Record<string, string> = {
  "amelia earhart": "a pioneering early-20th-century woman aviator with short auburn hair, a confident gaze, and period-accurate leather flight gear",
  "albert einstein": "an elderly theoretical physicist with wild white hair, a full moustache, and a dark period suit",
  "frida kahlo": "a Mexican painter with dark braided hair adorned with flowers, strong brows, and a colorful traditional blouse",
  "bob marley": "a Jamaican reggae musician with long dreadlocks, warm expressive eyes, and relaxed 1970s attire",
  "david bowie": "a distinctive British rock performer with angular features, styled hair, and bold era-specific stage clothing",
  "elvis presley": "a charismatic mid-century rock-and-roll singer with swept-back dark hair and a sharp vintage stage suit",
  "marilyn monroe": "a classic mid-century film actress with platinum curls, softly arched brows, and an elegant vintage dress",
  "nelson mandela": "an elder South African statesman with close-cropped white hair, kind eyes, and a dignified formal suit",
  "vincent van gogh": "a nineteenth-century Dutch painter with reddish hair, a short beard, and a worn blue work jacket",
};

const SUBJECT_REPLACEMENT_SYSTEM = `You create concise provider-safe visual descriptions for named people or characters in image and video prompts.
Return ONLY valid JSON in exactly this shape:
{"characterDescription":"..."}
The description must be 12–40 words, describe observable appearance, clothing, era, and demeanor, and be usable as a direct replacement inside a visual scene script.
Do not include the supplied name, pronouns that refer back to it, commentary, or claims about an exact likeness. Prefer historically grounded visual traits when the subject is a historical figure.`;

function fallbackCharacterDescription(namedSubject: string): string {
  return KNOWN_SUBJECT_DESCRIPTIONS[namedSubject.trim().toLocaleLowerCase()]
    ?? "a historically grounded figure with distinctive period-appropriate features, clothing, and demeanor based on the surrounding scene";
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
