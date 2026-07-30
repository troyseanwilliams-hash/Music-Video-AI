// AI lyric generation — fetch-based, no SDK dependency (mirrors renderEmail).
//
// Uses whichever LLM key is set: ANTHROPIC_API_KEY (preferred) or
// OPENAI_API_KEY. Falls back to a structured template so the admin flow works
// with no key at all. Output uses [Verse]/[Chorus]/[Bridge] section tags that
// both ACE-Step and the karaoke engine understand.

import { logger } from "./logger.js";

export interface LyricsRequest {
  theme: string; // what the song is about
  genre?: string; // e.g. "lofi", "industrial rock"
  mood?: string; // e.g. "calm", "energetic"
}

const SYSTEM_PROMPT = `You are an acclaimed songwriter with a vivid, distinctive voice. Write ORIGINAL song lyrics only — never reproduce or closely imitate existing copyrighted songs.

Craft rules:
- Open in a fresh, specific way — a concrete image, a small moment, a line of dialogue, an unexpected angle. NEVER open with clichés like "Thinking about…", "Woke up…", "Here I am…", "In the/this …", or by restating the theme.
- Use concrete, sensory detail and a consistent point of view. Show, don't tell. No greeting-card platitudes or filler lines.
- Give it real shape with section tags on their own lines: [Intro], [Verse], [Pre-Chorus], [Chorus], [Verse], [Bridge], [Chorus], [Outro]. Verses that build, a bridge that turns, and a repeated, singable chorus.
- Aim for a full-length song (~5 minutes sung): 2–3 verses.

Return ONLY the lyrics with section tags — no title, commentary, or explanation.`;

// Rotate the opening approach so no two generations start the same way.
const OPENING_ANGLES = [
  "Open mid-scene, dropping the listener into a specific moment already in motion.",
  "Open on one striking, concrete image tied to the theme — no preamble.",
  "Open with a line of overheard or remembered dialogue.",
  "Open on a small telling detail (an object, a place, a gesture) rather than the big idea.",
  "Open with a question the rest of the song answers.",
  "Open at the end of the story and work backward.",
  "Open with motion — someone leaving, arriving, reaching for something.",
];

function buildUserPrompt(req: LyricsRequest): string {
  const parts = [`Write original song lyrics about: ${req.theme}.`];
  if (req.genre) parts.push(`Genre: ${req.genre}.`);
  if (req.mood) parts.push(`Mood: ${req.mood}.`);
  parts.push("Make the chorus catchy and repeatable, and vary the opening from the obvious.");
  parts.push(OPENING_ANGLES[Math.floor(Math.random() * OPENING_ANGLES.length)]!);
  return parts.join(" ");
}

// ── Providers ────────────────────────────────────────────────────────────────

async function viaAnthropic(req: LyricsRequest): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.LYRICS_ANTHROPIC_MODEL ?? "claude-sonnet-5",
      max_tokens: 1500,
      temperature: 1,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(req) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  const text = data.content?.map((b) => b.text ?? "").join("").trim();
  if (!text) throw new Error("Anthropic returned no lyrics");
  return text;
}

async function viaOpenAI(req: LyricsRequest): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.LYRICS_OPENAI_MODEL ?? "gpt-4o-mini",
      max_tokens: 1500,
      temperature: 1.05,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(req) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned no lyrics");
  return text;
}

// ── Template fallback (no key) ───────────────────────────────────────────────

// Deterministic-quality fallback used only when no LLM key is configured. Picks
// randomly from several openings/verses/bridges so it isn't identical every time
// (the LLM path is far better — set ANTHROPIC_API_KEY for real variety).
function templateLyrics(req: LyricsRequest): string {
  const t = req.theme.trim() || "the open road";
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

  const verse1 = pick([
    `Streetlights blur outside the glass\n${cap} on my mind and it won't pass\nCounting all the reasons to stay\nBut something keeps pulling me away`,
    `Left the door a little open\nWords I meant but left unspoken\n${cap} humming in the dark\nA quiet fire, a stubborn spark`,
    `Rain came down and forgot to stop\nI watched it pool and overflow the top\n${cap} written in the fog\nA restless heart, a barking dog`,
    `A half-drawn map, a rolled-up sleeve\nMore in these hands than I believe\n${cap} is calling out my name\nAnd nothing here will feel the same`,
  ]);
  const prechorus = pick([
    `And when the lights go low\nThere's only one way left to go`,
    `So hold your breath and count to three\nThis is who we're meant to be`,
    `The night leans in, the city sighs\nI'm seeing it with open eyes`,
  ]);
  const chorus = `${cap}, carry me away\n${cap}, I'm here to stay\nEvery heartbeat, every mile\n${cap} makes it all worthwhile`;
  const verse2 = pick([
    `Miles behind and miles to come\nBeating steady like a drum\nNothing's gonna hold me back\n${cap} keeps me on the track`,
    `Photographs and dust and time\nA borrowed tune, a broken rhyme\n${cap} steady as the tide\nI'll keep it burning deep inside`,
    `We traded silence for the road\nDropped the weight and left the load\n${cap} rising with the sun\nThe best of it has just begun`,
  ]);
  const bridge = pick([
    `Close my eyes and breathe it in\nThis is where the dreams begin`,
    `Tear the map, forget the plan\nI'll find the ending where I can`,
    `If it breaks, then let it break\nSome things are worth the ache`,
  ]);

  return `[Intro]\n\n[Verse]\n${verse1}\n\n[Pre-Chorus]\n${prechorus}\n\n[Chorus]\n${chorus}\n\n[Verse]\n${verse2}\n\n[Bridge]\n${bridge}\n\n[Chorus]\n${chorus}\n\n[Outro]\n${cap}... carry me away`;
}

// ── Public entry ─────────────────────────────────────────────────────────────

export function lyricsProviderAvailable(): "anthropic" | "openai" | "template" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "template";
}

export async function generateLyrics(req: LyricsRequest): Promise<{ lyrics: string; source: string }> {
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      return { lyrics: await viaAnthropic(req), source: "anthropic" };
    }
    if (process.env.OPENAI_API_KEY) {
      return { lyrics: await viaOpenAI(req), source: "openai" };
    }
  } catch (err) {
    logger.error({ err }, "LLM lyric generation failed — falling back to template");
  }
  return { lyrics: templateLyrics(req), source: "template" };
}
