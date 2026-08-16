// AssemblyAI lyric alignment: transcribe a song's vocal and return word-level
// timings as ENHANCED LRC ([mm:ss.xx]<mm:ss.xx>word …), the exact format
// lyricTiming.ts → buildAssKaraoke() already consumes at render time.
//
// Two modes:
//   • lyricsText provided → keep the user's exact words, map ASR word times
//     onto them in order ("aligned"). ASR mishears sung words, so we trust the
//     user's text and only borrow the timing.
//   • no lyricsText → use the transcription itself, grouped into lines ("asr").
//
// Env: ASSEMBLYAI_API_KEY. Cheapest async tier is Universal-2 (speech_model
// "universal"). AssemblyAI fetches the (signed) audio URL directly.

const AAI_BASE = "https://api.assemblyai.com/v2";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function lyricAlignAvailable(): boolean {
  return !!process.env.ASSEMBLYAI_API_KEY;
}

interface AaiWord { text: string; start: number; end: number; confidence: number }

export interface AlignResult {
  lrc: string;
  confidence: number;            // 0..1 overall
  source: "aligned" | "asr";
  wordCount: number;
  lowConfidence: boolean;
}

type WordT = { text: string; start: number };
type LineT = { start: number; words: WordT[] };

function p2(n: number): string { return String(n).padStart(2, "0"); }
function fmt(t: number): string {
  if (t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  return `${p2(m)}:${p2(s)}.${p2(cs)}`;
}

/** Displayable lyric lines: drop [section] labels, stray tags, and blanks. */
function plainLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\[[^\]]*\]/g, "").replace(/<[^>]*>/g, "").trim())
    .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l));
}

function toLrc(lines: LineT[]): string {
  return lines
    .map((ln) => `[${fmt(ln.start)}]` + ln.words.map((w) => `<${fmt(w.start)}>${w.text}`).join(" "))
    .join("\n");
}

/** Map the user's known lyric lines onto ASR word timings, sequentially. */
function alignToLyrics(rawLyrics: string, words: AaiWord[]): LineT[] {
  const lines = plainLines(rawLyrics);
  const times = words.map((w) => w.start / 1000);
  const lastT = times.length ? times[times.length - 1]! : 0;
  let wi = 0;
  const out: LineT[] = [];
  for (const line of lines) {
    const toks = line.split(/\s+/).filter(Boolean);
    const lw: WordT[] = [];
    for (const tok of toks) {
      let t: number;
      if (wi < times.length) { t = times[wi]!; wi++; }
      else { t = lastT + 0.3 * (lw.length + 1); } // ran out of ASR words — extrapolate
      lw.push({ text: tok, start: t });
    }
    if (lw.length) out.push({ start: lw[0]!.start, words: lw });
  }
  return out;
}

/** No lyrics supplied: group ASR words into lines by pauses / length. */
function linesFromAsr(words: AaiWord[]): LineT[] {
  const out: LineT[] = [];
  let cur: WordT[] = [];
  let prevEnd = 0;
  for (const w of words) {
    const gap = w.start / 1000 - prevEnd;
    if (cur.length > 0 && (gap > 1.0 || cur.length >= 8)) {
      out.push({ start: cur[0]!.start, words: cur });
      cur = [];
    }
    cur.push({ text: w.text, start: w.start / 1000 });
    prevEnd = w.end / 1000;
  }
  if (cur.length) out.push({ start: cur[0]!.start, words: cur });
  return out;
}

export async function alignLyrics(params: { audioUrl: string; lyricsText?: string | null }): Promise<AlignResult> {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("Lyric alignment requires ASSEMBLYAI_API_KEY");

  // 1. Submit — AssemblyAI pulls the signed audio URL itself.
  const submit = await fetch(`${AAI_BASE}/transcript`, {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: params.audioUrl,
      speech_model: "universal", // Universal-2 — cheapest async tier
      punctuate: true,
      format_text: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) throw new Error(`AssemblyAI submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const submitted = (await submit.json()) as { id?: string };
  const id = submitted.id;
  if (!id) throw new Error("AssemblyAI: no transcript id returned");

  // 2. Poll — songs are short, allow ~3 min.
  type AaiTranscript = { status?: string; error?: string; words?: AaiWord[]; confidence?: number; text?: string };
  let data: AaiTranscript | null = null;
  for (let i = 0; i < 60; i++) {
    await delay(3000);
    const res = await fetch(`${AAI_BASE}/transcript/${id}`, {
      headers: { authorization: key },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) continue;
    data = (await res.json()) as AaiTranscript;
    if (data?.status === "completed") break;
    if (data?.status === "error") throw new Error(`AssemblyAI: ${data.error ?? "transcription failed"}`);
  }
  if (!data || data.status !== "completed") throw new Error("AssemblyAI timed out after ~3 minutes");

  const words = data.words ?? [];
  if (words.length === 0) throw new Error("No vocal words detected — is the track instrumental?");

  const hasLyrics = !!(params.lyricsText && params.lyricsText.trim());
  const source: "aligned" | "asr" = hasLyrics ? "aligned" : "asr";
  const grouped = hasLyrics ? alignToLyrics(params.lyricsText!, words) : linesFromAsr(words);

  const confidence = typeof data.confidence === "number"
    ? data.confidence
    : words.reduce((s, w) => s + (w.confidence ?? 0), 0) / words.length;

  return {
    lrc: toLrc(grouped),
    confidence,
    source,
    wordCount: words.length,
    lowConfidence: confidence < 0.5,
  };
}
