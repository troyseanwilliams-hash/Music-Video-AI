export type PodcastWordTiming = { text: string; start: number; end: number };

/** Converts AssemblyAI millisecond word timings to production SRT cues. */
export function buildTimedSrt(words: PodcastWordTiming[]): string {
  const stamp = (ms: number) => {
    const value = Math.max(0, Math.round(ms));
    const h = Math.floor(value / 3_600_000);
    const m = Math.floor(value / 60_000) % 60;
    const s = Math.floor(value / 1_000) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(value % 1_000).padStart(3, "0")}`;
  };
  const valid = words.filter(word => typeof word.text === "string" && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);
  const cues: PodcastWordTiming[][] = [];
  let cue: PodcastWordTiming[] = [];
  for (const word of valid) {
    cue.push(word);
    if (cue.length >= 7 || /[.!?]$/.test(word.text)) { cues.push(cue); cue = []; }
  }
  if (cue.length) cues.push(cue);
  return cues.map((group, index) => `${index + 1}\n${stamp(group[0]!.start)} --> ${stamp(group[group.length - 1]!.end)}\n${group.map(word => word.text.replace(/[<>]/g, "")).join(" ")}\n`).join("\n");
}

export function podcastRenderArgs(input: string, srt: string, master: string, isVideo: boolean): string[] {
  return isVideo
    ? ["-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-vf", `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,subtitles=${srt}`, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", master]
    : ["-y", "-i", input, "-filter_complex", `[0:a]showwaves=s=1920x1080:mode=line:colors=0x7dd3fc,format=yuv420p,subtitles=${srt}[v]`, "-map", "[v]", "-map", "0:a:0", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-shortest", "-movflags", "+faststart", master];
}

export type PodcastHighlight = { index: number; title: string; description: string; startTime: number; durationSeconds: number };
/** Selects three sentence-led, non-overlapping editorial windows from ASR timings. */
export function selectPodcastHighlights(words: PodcastWordTiming[], duration: number): PodcastHighlight[] {
  if (duration < 90) throw new Error("Podcast media must be at least 90 seconds to create three meaningful highlights.");
  const sentences: { start: number; end: number; text: string }[] = [];
  let group: PodcastWordTiming[] = [];
  for (const word of words) {
    if (word.end <= word.start) continue;
    group.push(word);
    if (/[.!?]$/.test(word.text) || group.length >= 24) {
      sentences.push({ start: group[0]!.start / 1000, end: group[group.length - 1]!.end / 1000, text: group.map(item => item.text).join(" ") });
      group = [];
    }
  }
  if (group.length) sentences.push({ start: group[0]!.start / 1000, end: group[group.length - 1]!.end / 1000, text: group.map(item => item.text).join(" ") });
  const picks: PodcastHighlight[] = [];
  for (const sentence of sentences) {
    const start = Math.max(0, Math.min(duration - 30, sentence.start));
    if (picks.every(pick => start >= pick.startTime + pick.durationSeconds || start + 30 <= pick.startTime)) {
      const phrase = sentence.text.replace(/[.!?]+$/, "").trim();
      picks.push({ index: picks.length, title: phrase.split(/\s+/).slice(0, 7).join(" ") || "Podcast moment", description: phrase.slice(0, 220) || "Conversation highlight", startTime: start, durationSeconds: 30 });
      if (picks.length === 3) return picks;
    }
  }
  throw new Error("The transcript does not contain three distinct highlight moments.");
}