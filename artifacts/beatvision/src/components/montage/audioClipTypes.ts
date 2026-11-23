import type { StudioAudioClip } from "@workspace/api-client-react";
import { END_TOLERANCE_SEC, MAX_TIMELINE_SEC, type LayerIssue } from "./overlayTypes";

export type AudioClip = StudioAudioClip;

export const MAX_AUDIO_CLIPS = 100;
export const MAX_SIMULTANEOUS_AUDIO_CLIPS = 4;
export const MIN_AUDIO_CLIP_SEC = 0.1;
export const DEFAULT_AUDIO_CLIP_SEC = 5;
export const DEFAULT_AUDIO_CLIP_VOLUME = 0.8;
/** Slack allowed between requested and decoded source length. */
export const SOURCE_TOLERANCE_SEC = 0.05;

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function audioClipId() {
  return "ac_" + Math.random().toString(36).slice(2, 10);
}

/**
 * Restores a clip from a saved manifest. Finite numbers are preserved exactly
 * (never clamped) and a missing objectPath is kept as "" so validateAudioClips
 * surfaces the problem instead of silently changing or dropping the clip.
 * Missing/non-numeric values become NaN and are reported as invalid.
 */
export function normalizeAudioClip(raw: unknown): AudioClip | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    id: typeof o.id === "string" && o.id ? o.id.slice(0, 100) : audioClipId(),
    name: typeof o.name === "string" ? o.name.slice(0, 120) : "Music clip",
    objectPath: typeof o.objectPath === "string" ? o.objectPath : "",
    startSec: num(o.startSec, Number.NaN),
    durationSec: num(o.durationSec, Number.NaN),
    trimStart: num(o.trimStart, Number.NaN),
    volume: num(o.volume, Number.NaN),
    ...(o.fadeInSec === undefined ? {} : { fadeInSec: num(o.fadeInSec, Number.NaN) }),
    ...(o.fadeOutSec === undefined ? {} : { fadeOutSec: num(o.fadeOutSec, Number.NaN) }),
  };
}

/** Legacy manifests without audioClips restore as an empty list. */
export function normalizeAudioClipList(raw: unknown): AudioClip[] {
  return Array.isArray(raw) ? raw.map(normalizeAudioClip).filter((c): c is AudioClip => !!c) : [];
}

/** Exact serializable shape (stable key order) for manifests and render requests. */
export function serializeAudioClips(clips: AudioClip[]): AudioClip[] {
  return clips.map(({ id, name, objectPath, startSec, durationSec, trimStart, volume, fadeInSec, fadeOutSec }) => ({
    id, name, objectPath, startSec, durationSec, trimStart, volume,
    ...(fadeInSec === undefined ? {} : { fadeInSec }),
    ...(fadeOutSec === undefined ? {} : { fadeOutSec }),
  }));
}

/** Linear clip-local envelopes multiply when fades overlap. Source trim is unrelated. */
export function audioClipGain(clip: AudioClip, timeSec: number): number {
  const t = timeSec - clip.startSec;
  if (t < 0 || t >= clip.durationSec) return 0;
  const ramp = (elapsed: number, fade = 0) => fade > 0 ? Math.min(1, Math.max(0, elapsed / fade)) : 1;
  return clip.volume * ramp(t, clip.fadeInSec) * ramp(clip.durationSec - t, clip.fadeOutSec);
}

/** Timeline time -> whether the clip sounds, and where in the source file. */
export function audioClipPlayback(clip: Pick<AudioClip, "startSec" | "durationSec" | "trimStart">, timeSec: number) {
  const active = timeSec >= clip.startSec && timeSec < clip.startSec + clip.durationSec;
  return { active, sourceSec: clip.trimStart + Math.max(0, timeSec - clip.startSec) };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;

export function validateAudioClips(
  clips: AudioClip[],
  totalSec: number,
  sourceDurations: Record<string, number> = {},
): LayerIssue[] {
  const issues: LayerIssue[] = [];
  if (clips.length > MAX_AUDIO_CLIPS) {
    issues.push({ id: null, message: `${clips.length} music clips — the limit is ${MAX_AUDIO_CLIPS}. Remove ${clips.length - MAX_AUDIO_CLIPS}.` });
  }
  const limit = Math.min(totalSec, MAX_TIMELINE_SEC) + END_TOLERANCE_SEC;
  clips.forEach((c, i) => {
    const label = `Music clip ${i + 1} ("${c.name}")`;
    for (const fade of [c.fadeInSec, c.fadeOutSec]) {
      if (fade !== undefined && (!Number.isFinite(fade) || fade < 0 || fade > c.durationSec))
        issues.push({ id: c.id, message: `${label} fades must be between 0 and the clip length in seconds.` });
    }
    const values = [c.startSec, c.durationSec, c.trimStart, c.volume];
    if (values.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      issues.push({ id: c.id, message: `${label} has an invalid number.` });
      return;
    }
    if (!c.objectPath) issues.push({ id: c.id, message: `${label} is missing its song file. Delete it and add the song again.` });
    if (!c.name.trim()) issues.push({ id: c.id, message: `Music clip ${i + 1} needs a name.` });
    if (c.startSec < 0) issues.push({ id: c.id, message: `${label} starts before 0:00.` });
    if (c.durationSec < MIN_AUDIO_CLIP_SEC) issues.push({ id: c.id, message: `${label} must play for at least ${MIN_AUDIO_CLIP_SEC}s.` });
    if (c.startSec > MAX_TIMELINE_SEC) issues.push({ id: c.id, message: `${label} starts after the 30:00 limit.` });
    if (c.durationSec > MAX_TIMELINE_SEC) issues.push({ id: c.id, message: `${label} is longer than the 30:00 limit.` });
    if (c.trimStart > MAX_TIMELINE_SEC) issues.push({ id: c.id, message: `${label} song offset is beyond 30:00.` });
    if (c.trimStart < 0) issues.push({ id: c.id, message: `${label} has a negative song offset.` });
    if (c.volume < 0 || c.volume > 1) issues.push({ id: c.id, message: `${label} volume must be between 0 and 100%.` });
    const end = c.startSec + c.durationSec;
    if (end > limit) issues.push({ id: c.id, message: `${label} ends at ${fmt(end)}, after the main video ends at ${fmt(totalSec)}.` });
    const source = sourceDurations[c.objectPath];
    if (typeof source === "number" && Number.isFinite(source) && source > 0) {
      if (c.trimStart >= source) {
        issues.push({ id: c.id, message: `${label} starts at ${fmt(c.trimStart)} in a song that is only ${fmt(source)} long.` });
      } else if (c.trimStart + c.durationSec > source + SOURCE_TOLERANCE_SEC) {
        issues.push({ id: c.id, message: `${label} needs ${c.durationSec.toFixed(2)}s but only ${(source - c.trimStart).toFixed(2)}s of the song remain after the offset. Clips do not loop.` });
      }
    }
  });
  const events: Array<[number, number]> = [];
  for (const c of clips) { events.push([c.startSec, 1]); events.push([c.startSec + c.durationSec, -1]); }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0;
  for (const [t, d] of events) {
    live += d;
    if (live > MAX_SIMULTANEOUS_AUDIO_CLIPS) {
      issues.push({ id: null, message: `${live} music clips play at the same time around ${fmt(t)} — at most ${MAX_SIMULTANEOUS_AUDIO_CLIPS} can overlap.` });
      break;
    }
  }
  return issues;
}

/** Longest duration that fits the remaining timeline and source song. */
export function fitAudioDuration(startSec: number, trimStart: number, totalSec: number, sourceSec?: number, wanted = DEFAULT_AUDIO_CLIP_SEC) {
  let d = Math.min(wanted, Math.max(0, totalSec - startSec));
  if (typeof sourceSec === "number" && sourceSec > 0) d = Math.min(d, Math.max(0, sourceSec - trimStart));
  return Math.max(MIN_AUDIO_CLIP_SEC, Math.round(d * 100) / 100);
}

/** Reads a song's decoded length. Resolves null when unreadable or timed out. */
export function probeAudioDuration(url: string, timeoutMs = 15_000): Promise<number | null> {
  return new Promise((resolve) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    let done = false;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      a.removeAttribute("src");
      resolve(v);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    a.onloadedmetadata = () => finish(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
    a.onerror = () => finish(null);
    a.src = url;
  });
}
