// AI lyric generation through the managed Anthropic integration, with a legacy
// direct OpenAI path for environments that already configure it. The structured
// template is used only when no paid provider is configured.

import { logger } from "./logger.js";
import { anthropic } from "@workspace/integrations-anthropic-ai";

export interface LyricsRequest {
  theme: string; // what the song is about
  genre?: string; // e.g. "lofi", "industrial rock"
  mood?: string; // e.g. "calm", "energetic"
  // When set, polish/improve THESE draft lyrics instead of writing from scratch.
  existingLyrics?: string;
  // Target song length in seconds — scales how much lyric/structure to write so
  // the words fit the chosen song duration.
  targetSeconds?: number;
  // Allow explicit language. Defaults to false = radio-clean.
  explicit?: boolean;
  // Song tempo (BPM). When set, the writer matches line length / syllable
  // density to the groove so the words actually sing on the beat.
  bpm?: number;
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

STRUCTURE — use section tags on their own lines exactly like: [Intro], [Verse], [Pre-Chorus], [Chorus], [Verse], [Bridge], [Chorus], [Outro]. Include a repeated chorus and a bridge that turns. EVERY section tag you write MUST be followed by real lyric lines — never leave a section empty (an [Intro] or [Outro] with no words is not allowed). If a section would have no lyrics, leave its tag out entirely; if you open with [Intro], give it at least a line or two (an ad-lib, hook tease, or scene-setting line).

Return ONLY the finished lyrics with section tags — no title, notes, commentary, or explanation of any kind.`;

const ENHANCE_SYSTEM_PROMPT = `You are a careful lyric editor, not a replacement songwriter.

When given a draft, preserve the writer's song. Make only small, surgical edits for typos, grammar, singability, or an unmistakably awkward line. Preserve the draft's story, point of view, emotional intent, images, memorable phrases, chorus hook, section order, repeated sections, and line breaks. Keep the same approximate line count and do not add, remove, or reorder sections. Preserve most lines exactly as written. If the draft already works, return it unchanged.

Never write a new song, change the subject, replace the voice with your own, invent a new hook, or force a genre/style rewrite. Return ONLY the complete edited lyrics — no title, notes, commentary, or explanation.`;

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

// Match line length / syllable density to the groove so the words sing on-beat.
function tempoGuidance(bpm?: number): string {
  if (!bpm || bpm <= 0) return "";
  const feel = bpm < 85 ? "slow, spacious" : bpm < 115 ? "mid-tempo" : bpm < 140 ? "upbeat" : "fast, driving";
  const lineHint =
    bpm < 85
      ? "give lines room to breathe — longer, sustained phrases with fewer syllables per beat"
      : bpm >= 140
        ? "keep lines short and punchy, with tight rhythmic syllables that land right on the beat"
        : "keep an even, steady syllable count per line so the words sit naturally in the pocket";
  return `Tempo: about ${Math.round(bpm)} BPM (${feel}). Match line length and syllable density to this groove — ${lineHint}.`;
}

// Clean by default; only loosen when the caller explicitly opts in.
function contentGuidance(explicit?: boolean): string {
  return explicit
    ? "Explicit language is permitted where it genuinely serves the emotion — never gratuitous, and don't force it in."
    : "Keep it radio-clean: no profanity, slurs, or explicit adult intimate content.";
}

// Strip anything that isn't the song: model preambles ("Here are your lyrics:"),
// markdown code fences, and trailing chit-chat. Belt-and-suspenders on top of the
// prompt instruction so the UI never shows commentary.
function sanitizeLyrics(raw: string): string {
  let text = (raw ?? "").trim();
  // Remove surrounding markdown code fences if the model wrapped the output.
  text = text.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  // If there's a preamble before the first section tag AND it reads like
  // commentary, drop everything up to that first tag.
  const firstTag = text.search(/\[(intro|verse|pre-?chorus|chorus|bridge|hook|refrain|outro)\b/i);
  if (firstTag > 0) {
    const before = text.slice(0, firstTag);
    if (/lyric|here('|’)?s|sure[,!]|of course|certainly|happy to|:\s*$/i.test(before)) {
      text = text.slice(firstTag);
    }
  }
  // Drop a trailing note paragraph (separated by a blank line) that's clearly
  // the model talking, not lyrics.
  text = text.replace(/\n{2,}\s*(let me know|i hope|feel free|note:|hope (you|this)|enjoy!)[\s\S]*$/i, "").trim();
  return text.trim();
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
      "Lightly edit these draft lyrics. This is a preservation pass, not a rewrite.",
      "Keep the same story, voice, point of view, imagery, hook, section order, repeated sections, line breaks, and approximate line count.",
      "Change only clear typos, grammar problems, or a small number of genuinely awkward phrases that prevent the lyrics from singing naturally.",
      "Do not replace lines just to make them more poetic, do not add or remove sections, do not invent new imagery, and do not adjust the song to a target length.",
      "If no small change is clearly needed, return the draft exactly as provided.",
      "Return ONLY the complete edited lyrics — no commentary.",
    ];
    if (req.bpm) parts.push(`Keep the existing words and structure aligned to approximately ${req.bpm} BPM; make only minimal syllable edits where necessary.`);
    if (req.explicit === false) parts.push(contentGuidance(false));
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
  if (req.bpm) parts.push(tempoGuidance(req.bpm));
  parts.push(contentGuidance(req.explicit));
  if (len) parts.push(`Length: aim for a ${len} song, using [Verse]/[Chorus]/[Bridge] structure tags to shape it.`);
  parts.push("Land one memorable, repeatable chorus hook tied to a concrete image, and vary the opening from the obvious.");
  parts.push(OPENING_ANGLES[Math.floor(Math.random() * OPENING_ANGLES.length)]!);
  return parts.join(" ");
}

// ── Providers ────────────────────────────────────────────────────────────────

async function viaAnthropic(req: LyricsRequest): Promise<string> {
  const message = await anthropic.messages.create({
    // Lyrics quality is very model-sensitive, and it is one short, infrequent
    // call per song. Override with LYRICS_ANTHROPIC_MODEL when needed.
    model: process.env.LYRICS_ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    max_tokens: 8192,
    temperature: req.existingLyrics?.trim() ? 0.25 : 0.9,
    system: req.existingLyrics?.trim() ? ENHANCE_SYSTEM_PROMPT : SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(req) }],
  });
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) throw new Error("Anthropic returned no lyrics");
  return sanitizeLyrics(text);
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
      temperature: req.existingLyrics?.trim() ? 0.25 : 0.95,
      messages: [
        { role: "system", content: req.existingLyrics?.trim() ? ENHANCE_SYSTEM_PROMPT : SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(req) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned no lyrics");
  return sanitizeLyrics(text);
}

// ── Template fallback (no key) ───────────────────────────────────────────────

// Deterministic-quality fallback used only when no LLM key is configured. Picks
// randomly from several openings/verses/bridges so it isn't identical every time
// (the LLM path is far better — set ANTHROPIC_API_KEY for real variety).
//
// IMPORTANT: this fallback deliberately does NOT interpolate the user's
// description into the lyrics — echoing the prompt verbatim is exactly the
// behavior we forbid on the LLM path, so the template stays fully self-contained
// and generic. The theme only steers song selection, never the words.
function templateLyrics(_req: LyricsRequest): string {
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

  const intro = pick([
    `Oh-oh-oh, here we go\nOne more night, let it show`,
    `Hmm, yeah\nFeel it coming, slow and low`,
    `Here it comes, one more time\nCatch the rhythm, catch the rhyme`,
  ]);
  const verse1 = pick([
    `Streetlights blur outside the glass\nSomething on my mind that won't pass\nCounting all the reasons to stay\nBut something keeps pulling me away`,
    `Left the door a little open\nWords I meant but left unspoken\nA whisper humming in the dark\nA quiet fire, a stubborn spark`,
    `Rain came down and forgot to stop\nI watched it pool and overflow the top\nA message written in the fog\nA restless heart, a barking dog`,
    `A half-drawn map, a rolled-up sleeve\nMore in these hands than I believe\nI hear the far road call my name\nAnd nothing here will feel the same`,
  ]);
  const prechorus = pick([
    `And when the lights go low\nThere's only one way left to go`,
    `So hold your breath and count to three\nThis is who we're meant to be`,
    `The night leans in, the city sighs\nI'm seeing it with open eyes`,
  ]);
  const chorus = `Carry me away\nI'm here to stay\nEvery heartbeat, every mile\nMakes it all worthwhile`;
  const verse2 = pick([
    `Miles behind and miles to come\nBeating steady like a drum\nNothing's gonna hold me back\nStill I keep it on the track`,
    `Photographs and dust and time\nA borrowed tune, a broken rhyme\nSteady as the turning tide\nI'll keep it burning deep inside`,
    `We traded silence for the road\nDropped the weight and left the load\nSlowly rising with the sun\nThe best of it has just begun`,
  ]);
  const bridge = pick([
    `Close my eyes and breathe it in\nThis is where the dreams begin`,
    `Tear the map, forget the plan\nI'll find the ending where I can`,
    `If it breaks, then let it break\nSome things are worth the ache`,
  ]);

  return `[Intro]\n${intro}\n\n[Verse]\n${verse1}\n\n[Pre-Chorus]\n${prechorus}\n\n[Chorus]\n${chorus}\n\n[Verse]\n${verse2}\n\n[Bridge]\n${bridge}\n\n[Chorus]\n${chorus}\n\n[Outro]\nCarry me away...`;
}

// ── Public entry ─────────────────────────────────────────────────────────────

export function lyricsProviderAvailable(): "anthropic" | "openai" | "template" {
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    return "anthropic";
  }
  if (process.env.OPENAI_API_KEY) return "openai";
  return "template";
}

function lyricTokens(text: string): Set<string> {
  return new Set(
    text
      .replace(/\[[^\]]+\]/g, " ")
      .toLowerCase()
      .match(/[a-z0-9]+(?:['’][a-z0-9]+)?/g) ?? [],
  );
}

function sectionTags(text: string): string[] {
  return (text.match(/\[(?:intro|verse|pre-?chorus|chorus|bridge|hook|refrain|outro)\b[^\]]*\]/gi) ?? [])
    .map((tag) => tag.toLowerCase().replace(/\s+/g, ""));
}

export function preserveDraftIfRewritten(draft: string, candidate: string): string {
  const original = draft.trim();
  const edited = candidate.trim();
  if (!original || !edited) return original;

  const originalTags = sectionTags(original);
  const editedTags = sectionTags(edited);
  const tagsChanged =
    originalTags.length !== editedTags.length ||
    originalTags.some((tag, index) => tag !== editedTags[index]);
  if (tagsChanged) return original;

  const originalLines = original.split(/\r?\n/).filter((line) => line.trim()).length;
  const editedLines = edited.split(/\r?\n/).filter((line) => line.trim()).length;
  const lineRatio = editedLines / Math.max(originalLines, 1);
  if (lineRatio < 0.6 || lineRatio > 1.5) return original;

  const originalWords = lyricTokens(original);
  const editedWords = lyricTokens(edited);
  const sharedWords = [...originalWords].filter((word) => editedWords.has(word)).length;
  const similarity = sharedWords / Math.max(originalWords.size, editedWords.size, 1);
  return similarity >= 0.35 ? edited : original;
}

export async function generateLyrics(
  req: LyricsRequest,
): Promise<{ lyrics: string; source: string; changed: boolean }> {
  const original = req.existingLyrics?.trim();

  if (lyricsProviderAvailable() === "anthropic") {
    try {
      const lyrics = await viaAnthropic(req);
      const accepted = original ? preserveDraftIfRewritten(original, lyrics) : lyrics;
      return {
        lyrics: accepted,
        source: "anthropic",
        changed: !original || accepted !== original,
      };
    } catch (err) {
      logger.error({ err }, "Anthropic lyric generation failed");
      throw err;
    }
  }

  if (lyricsProviderAvailable() === "openai") {
    try {
      const lyrics = await viaOpenAI(req);
      const accepted = original ? preserveDraftIfRewritten(original, lyrics) : lyrics;
      return {
        lyrics: accepted,
        source: "openai",
        changed: !original || accepted !== original,
      };
    } catch (err) {
      logger.error({ err }, "OpenAI lyric generation failed");
      throw err;
    }
  }

  // The free fallback is never reported or billed as a paid model result.
  return {
    lyrics: original ?? templateLyrics(req),
    source: original ? "preserved-draft" : "template",
    changed: !original,
  };
}
