// Word-level lyric timing for karaoke-style lyric videos.
//
// Input is whatever the user pasted into the lyrics box:
//   1. Enhanced LRC  — [mm:ss.xx] line times + <mm:ss.xx> word times → exact
//      word-level karaoke.
//   2. Standard LRC  — [mm:ss.xx] line times → exact line sync; word times
//      are estimated within each line (proportional to word length).
//   3. Plain text    — lines distributed evenly across the track (v1
//      behavior); word times estimated the same way.
//
// Output feeds buildAssKaraoke(), which renders an ASS subtitle file with
// {\k} karaoke tags (burned in via ffmpeg's `subtitles` filter). Keep this
// file identical in artifacts/api-server and artifacts/worker.

export interface TimedWord {
  text: string;
  start: number; // seconds
  end: number;
}

export interface TimedLine {
  text: string;
  start: number;
  end: number;
  words: TimedWord[];
}

const MAX_LINES = 80;
const LINE_TAG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g;

function tagToSeconds(m: RegExpMatchArray): number {
  const min = parseInt(m[1]!, 10);
  const sec = parseInt(m[2]!, 10);
  const fracRaw = m[3] ?? "0";
  const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
  return min * 60 + sec + frac;
}

/** Weight for estimated word durations — longer words sing longer. */
function wordWeight(w: string): number {
  return w.replace(/[^\p{L}\p{N}]/gu, "").length + 1;
}

/** Distributes estimated word times across [start, end] of a line. */
function estimateWords(text: string, start: number, end: number): TimedWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const total = words.reduce((s, w) => s + wordWeight(w), 0);
  const span = Math.max(0.2, end - start);
  let t = start;
  return words.map((w) => {
    const dur = (wordWeight(w) / total) * span;
    const word = { text: w, start: t, end: t + dur };
    t += dur;
    return word;
  });
}

/** True if the text has [mm:ss] LRC line timestamps. */
export function isLrc(text: string): boolean {
  LINE_TAG.lastIndex = 0;
  return LINE_TAG.test(text);
}

function parseLrc(text: string, totalDuration: number): TimedLine[] {
  interface RawLine {
    start: number;
    body: string;
  }
  const raw: RawLine[] = [];

  for (const line of text.split(/\r?\n/)) {
    LINE_TAG.lastIndex = 0;
    const tags = [...line.matchAll(LINE_TAG)];
    if (tags.length === 0) continue; // metadata ([ar:..]) or untagged text
    const body = line.replace(LINE_TAG, "").trim();
    if (!body) continue;
    // A line may carry several timestamps (repeated chorus) — one entry each.
    for (const tag of tags) raw.push({ start: tagToSeconds(tag), body });
  }

  raw.sort((a, b) => a.start - b.start);
  const clipped = raw.filter((r) => r.start < totalDuration).slice(0, MAX_LINES);

  return clipped.map((r, i) => {
    const nextStart = clipped[i + 1]?.start ?? totalDuration;
    // Line shows until the next line starts, capped at 8s of hang time.
    const end = Math.min(nextStart, r.start + 8, totalDuration);

    // Enhanced LRC: <mm:ss.xx> tags inside the body give exact word times.
    WORD_TAG.lastIndex = 0;
    const wordTags = [...r.body.matchAll(WORD_TAG)];
    const plainBody = r.body.replace(WORD_TAG, " ").replace(/\s+/g, " ").trim();

    if (wordTags.length >= 2) {
      // Split the body on word tags: text between tag i and tag i+1 belongs
      // to the word starting at tag i.
      const words: TimedWord[] = [];
      const parts = r.body.split(WORD_TAG);
      // parts = [before, min, sec, frac, text, min, sec, frac, text, ...]
      const starts = wordTags.map((t) => tagToSeconds(t));
      let idx = 0;
      for (let p = 4; p - 4 < starts.length * 4; p += 4) {
        const wText = (parts[p] ?? "").trim();
        if (!wText) {
          idx++;
          continue;
        }
        const wStart = starts[idx]!;
        const wEnd = starts[idx + 1] ?? end;
        words.push({ text: wText, start: wStart, end: Math.max(wStart + 0.05, wEnd) });
        idx++;
      }
      if (words.length > 0) {
        return { text: plainBody, start: r.start, end, words };
      }
    }

    return {
      text: plainBody,
      start: r.start,
      end,
      words: estimateWords(plainBody, r.start, end),
    };
  });
}

function parsePlain(text: string, totalDuration: number): TimedLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES);
  if (lines.length === 0) return [];

  const dur = Math.max(1, totalDuration);
  const per = dur / lines.length;
  return lines.map((line, i) => {
    const start = i * per;
    const end = (i + 1) * per;
    return { text: line, start, end, words: estimateWords(line, start, end) };
  });
}

/** Parses lyrics (plain, LRC, or enhanced LRC) into timed lines + words. */
export function buildTimedLines(
  lyricsText: string,
  totalDuration: number,
): TimedLine[] {
  const text = lyricsText.trim();
  if (!text) return [];
  return isLrc(text)
    ? parseLrc(text, totalDuration)
    : parsePlain(text, totalDuration);
}

// ---------------------------------------------------------------------------
// ASS karaoke rendering
// ---------------------------------------------------------------------------

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${rest}`;
}

function escapeAss(s: string): string {
  return s.replace(/[{}\\]/g, "").slice(0, 200);
}

/**
 * Renders timed lines as an ASS subtitle script with {\k} karaoke tags:
 * unsung text is white, sung text fills in electric cyan.
 */
export function buildAssKaraoke(lines: TimedLine[]): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,DejaVu Sans,44,&H00EED322,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,2,1,2,60,60,54,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = lines
    .filter((l) => l.words.length > 0 && l.end > l.start)
    .map((l) => {
      // Lead-in: if the first word starts after the line appears, burn the
      // gap as a zero-highlight wait so the fill starts on time.
      const parts: string[] = [];
      const leadIn = Math.round((l.words[0]!.start - l.start) * 100);
      if (leadIn > 0) parts.push(`{\\k${leadIn}}`);
      for (const w of l.words) {
        const cs = Math.max(1, Math.round((w.end - w.start) * 100));
        parts.push(`{\\k${cs}}${escapeAss(w.text)} `);
      }
      return `Dialogue: 0,${assTime(l.start)},${assTime(l.end)},Karaoke,,0,0,0,,${parts.join("").trimEnd()}`;
    })
    .join("\n");

  return header + events + "\n";
}
