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
  // When set, polish/improve THESE draft lyrics instead of writing from scratch.
  existingLyrics?: string;
  // Target song length in seconds — scales how much lyric/structure to write so
  // the words fit the chosen song duration.
  targetSeconds?: number;
}

// Map a target duration to a concrete song structure so the amount of lyrics
// fits the chosen length (the vocal model derives length largely from lyrics).
function lengthGuidance(seconds?: number): string {
  if (!seconds || seconds <= 0) return "";
  if (seconds <= 45) return "very short (~30-45s): one verse and one chorus";
  if (seconds <= 75) return "short (~1 min): one verse and a repeated chorus";
  if (seconds <= 105) return "~1.5 min: verse, chorus, verse, chorus";
  if (seconds <= 150) return "~2 min: verse, pre-chorus, chorus, verse, chorus";
  if (seconds <= 210) return "~3 min: 2-3 verses, a repeated chorus, and a short bridge";
  if (seconds <= 270) return "~4 min: intro, 3 verses, a pre-chorus, repeated choruses, and a bridge";
  return "~5 min: a full arrangement — intro, 3-4 verses, a pre-chorus, repeated choruses, a bridge, and an outro";
}

const SYSTEM_PROMPT = `You are an acclaimed, award-winning songwriter with a vivid, distinctive voice. Write ORIGINAL song lyrics only — never reproduce, quote, or closely imitate existing copyrighted songs, titles, or hooks.

CRAFT — treat these as hard rules, not suggestions:
- Concrete over abstract. Anchor the song in specific, sensory, filmable details — objects, places, gestures, weather, times of day. Show the feeling through images; never name the emotion outright ("I'm so sad", "my heart is broken", "I feel alive" are banned).
- Fresh open. Start on a concrete image, a small moment already in motion, or a line of dialogue. NEVER open with "Thinking about…", "Woke up…", "Here I am…", "In the/this …", "Tonight I…", or by restating the theme.
- A real hook. The chorus must land one memorable, repeatable central line and return to it — singable, emotionally earned, and tied to the song's core image. Repetition in the chorus is good; filler is not.
- Prosody & singability. Keep a consistent, natural meter and line length within each section so the words actually sing. Favor strong end-rhymes and the occasional internal rhyme, but never bend grammar or force an awkward word just to rhyme. Use contractions and plain speech the way people actually sing.
- Emotional arc. Verse 1 sets the scene, verse 2 raises the stakes or turns, the bridge shifts perspective or breaks form, the final chorus hits hardest. Give it forward motion — don't restate the same idea in every verse.
- No AI tells. Avoid greeting-card platitudes, generic uplift ("shining bright", "reach for the sky", "we are one"), stacked adjectives, and cliché rhyme pairs (fire/desire, heart/apart, fly/sky). Cut any line that could belong to any song.
- Match the brief. Honor the requested genre and mood in diction, imagery, rhythm, and vocabulary — a trap song, a folk ballad, and a synthpop anthem should not sound alike.

STRUCTURE — use section tags on their own lines exactly like: [Intro], [Verse], [Pre-Chorus], [Chorus], [Verse], [Bridge], [Chorus], [Outro]. Include a repeated chorus and a bridge that turns.

Return ONLY the finished lyrics with section tags — no title, notes, commentary, or explanation of any kind.`;

// Nudge diction/rhythm toward the requested genre so a trap song and a folk
// ballad don't read the same. Free-text genres fall through to a generic note.
function genreGuidance(genre?: string): string {
  const g = (genre ?? "").toLowerCase();
  if (/rap|hip.?hop|trap|drill/.test(g)) return "Lean into rhythmic, syllable-dense lines, internal rhyme, and a hard, chantable hook; conversational, specific, present-tense.";
  if (/country|folk|americana|bluegrass/.test(g)) return "Tell a grounded story with plain-spoken, concrete detail and a warm, singable refrain; place and character matter.";
  if (/rock|punk|metal|grunge/.test(g)) return "Punchy, driving lines with attitude and tension; a chorus built to be shouted back.";
  if (/pop|synth|dance|edm|house/.test(g)) return "Bright, hooky, economical lines; a big repeatable chorus and a pre-chorus that lifts into it.";
  if (/r.?&.?b|soul|neo.?soul/.test(g)) return "Smooth, intimate phrasing with room for melisma; sensual, specific imagery and a slow-burn hook.";
  if (/indie|alt|dream|shoegaze|lo.?fi/.test(g)) return "Impressionistic, image-first lines with a wistful, understated hook; mood over exposition.";
  if (/ballad|acoustic|singer.?songwriter/.test(g)) return "Quiet, confessional detail that builds; let one honest image carry the chorus.";
  return "Match the phrasing, rhythm, and vocabulary to the genre's conventions.";
}

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
  const len = lengthGuidance(req.targetSeconds);

  // Enhance mode: polish the user's draft rather than writing fresh lyrics.
  if (req.existingLyrics && req.existingLyrics.trim()) {
    const parts = [
      "Polish and elevate these draft song lyrics. Keep their core meaning, theme, and voice, but: replace any abstract or clichéd lines with concrete, sensory images; fix meter so each section sings evenly; strengthen the rhymes without forcing them; and sharpen the chorus into one memorable, repeatable hook. Add [Verse] / [Chorus] / [Bridge] structure tags where they help. Return ONLY the improved lyrics — no commentary.",
    ];
    if (req.genre) parts.push(`Genre: ${req.genre}. ${genreGuidance(req.genre)}`);
    if (req.mood) parts.push(`Mood: ${req.mood}.`);
    if (req.theme && req.theme.trim()) parts.push(`Emphasize this theme: ${req.theme}.`);
    if (len) parts.push(`Adjust the length to fit a ${len} song — add or trim sections as needed.`);
    parts.push(`\n\nDraft lyrics:\n${req.existingLyrics.trim()}`);
    return parts.join(" ");
  }
  const parts = [
    `Write original song lyrics inspired by this idea: "${req.theme}".`,
    // Users kept seeing their own description parroted back word-for-word. The
    // description is a brief, not source text to quote.
    "CRITICAL: Treat that description ONLY as subject matter. Do NOT copy, quote, echo, or reuse its exact words or phrases anywhere in the lyrics — not in the title line, not in the hook, not in any verse. Re-express the idea entirely in your own fresh, original wording. If a word from the description appears in your draft, replace it.",
  ];
  if (req.genre) {
    parts.push(`Genre: ${req.genre}. ${genreGuidance(req.genre)}`);
  }
  if (req.mood) parts.push(`Mood/emotional tone: ${req.mood} — carry it through the imagery and rhythm, don't just name it.`);
  if (len) parts.push(`Length: aim for a ${len} song, using [Verse]/[Chorus]/[Bridge] structure tags to shape it.`);
  parts.push("Land one memorable, repeatable chorus hook tied to a concrete image, and vary the opening from the obvious.");
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
      // Lyrics quality is very model-sensitive, and it's one short, infrequent
      // call per song — worth Sonnet. Override with LYRICS_ANTHROPIC_MODEL.
      model: process.env.LYRICS_ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
      max_tokens: 2000,
      temperature: 0.9,
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
      model: process.env.LYRICS_OPENAI_MODEL ?? "gpt-4o",
      max_tokens: 2000,
      temperature: 0.95,
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
