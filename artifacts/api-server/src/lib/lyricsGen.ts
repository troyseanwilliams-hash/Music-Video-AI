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

const SYSTEM_PROMPT = `You are a professional songwriter. Write original song lyrics only — never reproduce existing copyrighted songs.
Structure the song with section tags on their own lines: [Intro], [Verse], [Pre-Chorus], [Chorus], [Verse], [Bridge], [Chorus], [Outro].
Aim for a full-length song (roughly 5 minutes when sung): 2-3 verses, a repeated chorus, a bridge.
Return ONLY the lyrics with section tags — no titles, commentary, or explanations.`;

function buildUserPrompt(req: LyricsRequest): string {
  const parts = [`Write original song lyrics about: ${req.theme}.`];
  if (req.genre) parts.push(`Genre: ${req.genre}.`);
  if (req.mood) parts.push(`Mood: ${req.mood}.`);
  parts.push("Make the chorus catchy and repeatable.");
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

function templateLyrics(req: LyricsRequest): string {
  const t = req.theme.trim() || "the open road";
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return `[Intro]

[Verse]
Thinking about ${t} tonight
Everything is gonna be alright
Hold the feeling, let it grow
${cap} is all I need to know

[Pre-Chorus]
And when the lights go down
I hear the sound

[Chorus]
${cap}, carry me away
${cap}, I'm here to stay
Every heartbeat, every mile
${cap} makes it all worthwhile

[Verse]
Miles behind and miles to come
Beating steady like a drum
Nothing's gonna hold me back
${cap} keeps me on the track

[Bridge]
Close my eyes and breathe it in
This is where the dreams begin

[Chorus]
${cap}, carry me away
${cap}, I'm here to stay
Every heartbeat, every mile
${cap} makes it all worthwhile

[Outro]
${cap}... carry me away`;
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
