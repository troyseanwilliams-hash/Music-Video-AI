// Auto-cut vertical teaser clips for TikTok/Shorts.
//
// Given a finished video and its job's audio analysis, picks the most
// energetic moments (chorus/drop sections first, energy-ranked), cuts short
// segments with ffmpeg, and center-crops them to 9:16 (1080x1920).
// Pure ffmpeg — no AI generation, so it's fast and cheap.

import ffmpeg from "fluent-ffmpeg";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { withResourceLease } from "@workspace/db";

export interface TeaserMeta {
  index: number;
  objectPath: string; // filled by the caller after upload
  startTime: number;
  durationSec: number;
}

interface AnalysisSection {
  label?: string;
  start?: number;
  end?: number;
  energy?: number;
}

export const TEASER_COUNT = 3;
export const TEASER_DURATION_SEC = 10;

const HIGH_ENERGY_LABELS = new Set(["chorus", "drop", "hook", "climax"]);

function runFfmpeg(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return withResourceLease("ffmpeg_heavy", ({ signal }) => new Promise<void>((resolve, reject) => {
    signal.addEventListener("abort", () => {
      try { cmd.kill("SIGKILL"); } catch { /* exited */ }
      reject(signal.reason);
    }, { once: true });
    cmd.on("end", () => resolve()).on("error", (err) => reject(err)).run();
  }), { ttlMs: 10 * 60_000 });
}

/**
 * Picks up to `count` non-overlapping teaser start times, preferring
 * chorus/drop sections and high energy; falls back to even spacing.
 */
export function pickTeaserMoments(
  sections: AnalysisSection[] | null | undefined,
  videoDuration: number,
  count: number = TEASER_COUNT,
  teaserDur: number = TEASER_DURATION_SEC,
): number[] {
  const maxStart = Math.max(0, videoDuration - teaserDur);
  const candidates: { start: number; score: number }[] = [];

  for (const s of sections ?? []) {
    if (typeof s.start !== "number") continue;
    const start = Math.min(Math.max(0, s.start), maxStart);
    const label = (s.label ?? "").toLowerCase();
    const score =
      (HIGH_ENERGY_LABELS.has(label) ? 10 : 0) + (s.energy ?? 0);
    candidates.push({ start, score });
  }
  candidates.sort((a, b) => b.score - a.score);

  const picked: number[] = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    // Enforce non-overlap with already-picked windows.
    if (picked.every((p) => Math.abs(p - c.start) >= teaserDur)) {
      picked.push(c.start);
    }
  }

  // Fallback / fill: evenly spaced windows across the video.
  let i = 0;
  while (picked.length < count && i < count * 2) {
    const start = Math.min((videoDuration * (i + 0.5)) / (count + 1), maxStart);
    if (picked.every((p) => Math.abs(p - start) >= teaserDur)) {
      picked.push(Math.max(0, start));
    }
    i++;
  }

  return picked.slice(0, count).sort((a, b) => a - b);
}

/**
 * Cuts vertical 9:16 teasers from a source video buffer.
 * Returns one buffer per moment, in the same order.
 */
export async function cutTeasers(
  videoBuffer: Buffer,
  moments: number[],
  teaserDur: number = TEASER_DURATION_SEC,
): Promise<Buffer[]> {
  const tmpDir = join(tmpdir(), `bv_teaser_${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
  const srcPath = join(tmpDir, "src.mp4");

  try {
    await writeFile(srcPath, videoBuffer);
    const out: Buffer[] = [];

    for (let i = 0; i < moments.length; i++) {
      const outPath = join(tmpDir, `teaser_${i}.mp4`);
      await runFfmpeg(
        ffmpeg()
          .input(srcPath)
          .inputOptions(["-ss", String(moments[i])])
          .outputOptions([
            "-t", String(teaserDur),
            // Center-crop to 9:16, then normalize to 1080x1920.
            "-vf", "crop=min(iw\\,ih*9/16):ih,scale=1080:1920:flags=lanczos",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "22",
            "-threads", "2",
            "-c:a", "aac",
            "-b:a", "160k",
            "-movflags", "+faststart",
          ])
          .output(outPath),
      );
      out.push(await readFile(outPath));
    }

    return out;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
