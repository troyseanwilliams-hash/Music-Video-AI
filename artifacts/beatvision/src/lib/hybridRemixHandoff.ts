// "Guided Hybrid Lip Sync Remix": shared handoff contract + pure timeline
// math between LipSyncPanel (prepares the handoff after a successful Lip
// Sync result) and editor.tsx / Montage Studio (consumes it to prefill a
// replacement timeline). Deliberately dependency-free (no React, no fetch)
// so the timeline math is directly unit-testable.
//
// The idea: a completed Full-track video's original song audio is
// continuous and already correct for its whole length. A Lip Sync result is
// a short performance clip generated from an exact [start, start+seconds)
// slice of that same song. Inserting it means replacing that slice of the
// ORIGINAL video with the Lip Sync clip -- never adding to it -- and using
// the untouched original song as the one and only soundtrack, so the audio
// can never double or drift out of sync.

export const HYBRID_REMIX_KIND = "hybrid_lipsync" as const;

export interface HybridRemixHandoff {
  kind: typeof HYBRID_REMIX_KIND;
  originalVideoId: string;
  originalObjectPath: string;
  originalThumbnailPath: string | null;
  originalDurationSec: number;
  lipsyncVideoId: string;
  lipsyncObjectPath: string;
  lipsyncThumbnailPath: string | null;
  lipsyncStartTime: number;
  lipsyncDurationSec: number;
  songObjectPath: string;
  songDurationSec: number | null;
}

export interface HybridTimelineSegment {
  objectPath: string;
  thumbnailPath: string | null;
  durationSec: number;
  trimStart: number;
  trimEnd: number;
  label: "before" | "lipsync" | "after";
}

export interface HybridTimelineResult {
  segments: HybridTimelineSegment[];
  musicObjectPath: string;
  musicDurationSec: number | null;
}

// A computed segment shorter than this is treated as "empty" and omitted
// entirely, rather than inserting a near-zero-length clip -- this is what
// makes a Lip Sync range starting at 0:00 (no "before" segment) or ending at
// the song's end (no "after" segment) produce a clean 1-2 segment timeline
// instead of a degenerate sliver.
const MIN_SEGMENT_SECONDS = 0.15;

// Builds the up-to-three-segment replacement timeline: the original video up
// to the Lip Sync range, the Lip Sync clip itself, and the original video
// after the range -- covering the ORIGINAL video's full duration exactly
// once, with no gap and no overlap, regardless of where in the song the
// range falls (including right at the very start or very end).
export function buildHybridTimeline(h: HybridRemixHandoff): HybridTimelineResult {
  const originalDur = Math.max(0, h.originalDurationSec || 0);
  // Clamp defensively: a well-formed handoff (built from a Lip Sync request
  // that already passed the server's own range validation) never needs this,
  // but a hand-edited or corrupted sessionStorage payload could have an
  // out-of-range start/duration, and the timeline must still come out sane
  // (covering exactly [0, originalDur], never negative, never overlapping)
  // rather than producing a broken export.
  const start = Math.max(0, Math.min(h.lipsyncStartTime || 0, originalDur));
  const end = Math.max(start, Math.min(start + Math.max(0, h.lipsyncDurationSec || 0), originalDur));

  const segments: HybridTimelineSegment[] = [];

  const beforeDur = start;
  if (beforeDur > MIN_SEGMENT_SECONDS) {
    segments.push({
      objectPath: h.originalObjectPath,
      thumbnailPath: h.originalThumbnailPath,
      durationSec: beforeDur,
      trimStart: 0,
      trimEnd: Math.max(0, originalDur - start),
      label: "before",
    });
  }

  const lipsyncDur = end - start;
  if (lipsyncDur > MIN_SEGMENT_SECONDS) {
    segments.push({
      objectPath: h.lipsyncObjectPath,
      thumbnailPath: h.lipsyncThumbnailPath,
      durationSec: lipsyncDur,
      trimStart: 0,
      trimEnd: 0,
      label: "lipsync",
    });
  }

  const afterDur = originalDur - end;
  if (afterDur > MIN_SEGMENT_SECONDS) {
    segments.push({
      objectPath: h.originalObjectPath,
      thumbnailPath: h.originalThumbnailPath,
      durationSec: afterDur,
      trimStart: end,
      trimEnd: 0,
      label: "after",
    });
  }

  return { segments, musicObjectPath: h.songObjectPath, musicDurationSec: h.songDurationSec };
}

// Total duration of the built timeline -- should always equal the original
// video's duration exactly (the whole point: the finished hybrid keeps the
// original Full-track duration, never longer or shorter).
export function hybridTimelineDurationSec(result: HybridTimelineResult): number {
  return result.segments.reduce((sum, s) => sum + s.durationSec, 0);
}

// A source song whose own analyzed length disagrees with the finished
// video's real length by more than this can't be trusted as a clean,
// continuous replacement soundtrack for the full timeline -- surfaced as a
// safe "mismatched duration" state instead of silently producing a video
// whose audio runs short or is cut off.
export const DURATION_MISMATCH_TOLERANCE_SEC = 2;

export function isDurationMismatched(
  originalDurationSec: number,
  songDurationSec: number | null,
): boolean {
  if (songDurationSec == null) return false; // "unavailable", not "mismatched" -- handled separately
  return Math.abs(originalDurationSec - songDurationSec) > DURATION_MISMATCH_TOLERANCE_SEC;
}

// Validates an untrusted sessionStorage payload before trusting it as a
// HybridRemixHandoff -- a corrupted, hand-edited, or stale (e.g. from an
// older app version) payload must fail closed here rather than blow up
// buildHybridTimeline or the editor with a confusing runtime error. This is
// the "failed-handoff" safety net: editor.tsx falls back to a normal empty
// timeline whenever this returns false.
export function isValidHybridHandoff(value: unknown): value is HybridRemixHandoff {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== HYBRID_REMIX_KIND) return false;
  const isNonEmptyString = (x: unknown) => typeof x === "string" && x.length > 0;
  const isFiniteNumber = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  return (
    isNonEmptyString(v.originalVideoId) &&
    isNonEmptyString(v.originalObjectPath) &&
    (v.originalThumbnailPath === null || typeof v.originalThumbnailPath === "string") &&
    isFiniteNumber(v.originalDurationSec) &&
    (v.originalDurationSec as number) > 0 &&
    isNonEmptyString(v.lipsyncVideoId) &&
    isNonEmptyString(v.lipsyncObjectPath) &&
    (v.lipsyncThumbnailPath === null || typeof v.lipsyncThumbnailPath === "string") &&
    isFiniteNumber(v.lipsyncStartTime) &&
    (v.lipsyncStartTime as number) >= 0 &&
    isFiniteNumber(v.lipsyncDurationSec) &&
    (v.lipsyncDurationSec as number) > 0 &&
    isNonEmptyString(v.songObjectPath) &&
    (v.songDurationSec === null || isFiniteNumber(v.songDurationSec))
  );
}
