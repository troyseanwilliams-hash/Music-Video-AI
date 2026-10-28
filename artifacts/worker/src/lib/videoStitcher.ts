import ffmpeg from "fluent-ffmpeg";
import { withResourceLease } from "@workspace/db";
import { writeFile, readFile, unlink, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { buildTimedLines, buildAssKaraoke, karaokeFontsDir } from "./lyricTiming.js";
import { resolveAvailableStitchSequence } from "./montageSequence.js";

// `:fontsdir=` option pointing libass at the bundled karaoke font (Archivo
// Black); empty string when the font directory is missing.
function fontsDirOpt(): string {
  const dir = karaokeFontsDir();
  return dir ? `:fontsdir=${dir.replace(/([\\':])/g, "\\$1")}` : "";
}


export interface StitchInput {
  // Retime the final chronological clip to its remaining timeline slot so an
  // explicit ending frame survives whole-second provider-duration rounding.
  preserveEndFrame?: boolean;
  clips: { buffer: Buffer; targetDuration: number }[];
  // Optional montage edit order. Each entry points at one item in `clips`.
  // Reusing indexes lets a small paid clip library recur across the timeline
  // without looping one source several times in a row.
  sequence?: number[];
  strictSequence?: boolean;
  // Optional: omit to stitch a silent video (no audio track at all) — used for
  // "no audio" generations that get a soundtrack added later in the Editor.
  audioBuffer?: Buffer;
  audioExt?: string;
  totalDuration: number;
  lyricsText?: string;
}

export interface StitchResult {
  videoBuffer: Buffer;
  thumbnailBuffer: Buffer;
  skippedClips: number; // clips left out because they couldn't be processed
  resolvedSequence: number[]; // actual source indexes used after corrupt-clip fallback
}

// A short render should never wait forever, but long caption/watermark encodes
// legitimately need more than 12 minutes on the production VM. Scale the
// deadline with output duration while keeping a hard upper bound.
const MIN_FFMPEG_TIMEOUT_MS = 12 * 60 * 1000;
const MAX_FFMPEG_TIMEOUT_MS = 45 * 60 * 1000;

function encodeTimeoutForDuration(totalDurationSeconds: number): number {
  const durationScaled = Math.ceil(Math.max(1, totalDurationSeconds) * 4_000);
  return Math.min(MAX_FFMPEG_TIMEOUT_MS, Math.max(MIN_FFMPEG_TIMEOUT_MS, durationScaled));
}

function runFfmpegWithTimeout(
  cmd: ffmpeg.FfmpegCommand,
  timeoutMs = MIN_FFMPEG_TIMEOUT_MS,
): Promise<void> {
  return withResourceLease("ffmpeg_heavy", (lease) => new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { cmd.kill("SIGKILL"); } catch { /* ignore */ }
      reject(new Error(`ffmpeg processing exceeded ${Math.ceil(timeoutMs / 60_000)} minutes`));
    }, timeoutMs);
    lease.signal.addEventListener("abort", () => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { cmd.kill("SIGKILL"); } catch { /* already exited */ }
      reject(lease.signal.reason);
    }, { once: true });
    cmd
      .on("end", () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } })
      .on("error", (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } })
      .run();
  }), { ttlMs: 10 * 60_000 });
}

// Burns a small semi-transparent "AIBeatSync" watermark (bottom-right) onto a
// finished video. Used for Starter-tier exports so shared videos market the site
// (Pro/Studio render clean). Returns the watermarked buffer; on any failure it
// returns the original so a watermark hiccup never fails a render.
export async function applyWatermark(
  videoBuffer: Buffer,
  totalDurationSeconds = 0,
): Promise<Buffer> {
  const tmpDir = join(tmpdir(), `bv_wm_${randomUUID()}`);
  const inPath = join(tmpDir, "in.mp4");
  const outPath = join(tmpDir, "out.mp4");
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(inPath, videoBuffer);
    const draw =
      "drawtext=text='Made with AIBeatSync · aibeatsync.com':fontcolor=white@0.85:fontsize=h/28:" +
      "box=1:boxcolor=black@0.35:boxborderw=8:x=w-text_w-24:y=h-text_h-24";
    await runFfmpegWithTimeout(
      ffmpeg(inPath)
        .videoFilters(draw)
        .outputOptions([
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
          "-threads", "2",
          "-c:a", "copy", "-movflags", "+faststart",
        ])
        .output(outPath),
      encodeTimeoutForDuration(totalDurationSeconds),
    );
    return await readFile(outPath);
  } catch {
    return videoBuffer;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function createWebPreview(
  videoBuffer: Buffer,
  totalDurationSeconds = 0,
): Promise<Buffer> {
  const tmpDir = join(tmpdir(), `bv_preview_${randomUUID()}`);
  const inPath = join(tmpDir, "master.mp4");
  const outPath = join(tmpDir, "preview.mp4");
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(inPath, videoBuffer);
    await runFfmpegWithTimeout(
      ffmpeg(inPath)
        .outputOptions([
          "-map", "0:v:0",
          "-map", "0:a:0?",
          "-vf", "scale='min(iw,1280)':-2",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-b:v", "2200k",
          "-maxrate", "2800k",
          "-bufsize", "5600k",
          "-g", "48",
          "-keyint_min", "48",
          "-pix_fmt", "yuv420p",
          "-threads", "2",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
        ])
        .output(outPath),
      encodeTimeoutForDuration(totalDurationSeconds),
    );
    return await readFile(outPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function trimOrLoopClip(
  inputPath: string,
  outputPath: string,
  targetSeconds: number,
  timing?: { normalize: boolean; preserveEnd: boolean },
): Promise<void> {
  let filter = "scale='min(iw,1920)':-2";
  if (timing?.preserveEnd) {
    const sourceSeconds = await new Promise<number>((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (error, data) => {
        if (error) return reject(error);
        const video = data.streams.find((stream) => stream.codec_type === "video");
        const duration = Number(video?.duration ?? data.format.duration);
        if (!Number.isFinite(duration) || duration <= 0) return reject(new Error("Cannot verify ending-frame clip duration."));
        resolve(duration);
      });
    });
    // Pad before fps conversion so the last source frame survives sampling.
    const scale = Math.max(0.001, targetSeconds - Math.min(0.1, targetSeconds / 10)) / sourceSeconds;
    filter = `setpts=${scale}*(PTS-STARTPTS),tpad=stop_mode=clone:stop_duration=${targetSeconds},${filter}`;
  }
  if (timing?.normalize) filter += ",setpts=PTS-STARTPTS,fps=30";
  // Fill the exact slot after fps has normalized the EOF timestamp.
  if (timing?.preserveEnd) filter += `,tpad=stop_mode=clone:stop_duration=${targetSeconds}`;
  await runFfmpegWithTimeout(
    ffmpeg()
      .input(inputPath)
      .inputOptions(timing?.preserveEnd ? [] : ["-stream_loop", "-1"])
      .outputOptions([
        "-t", String(targetSeconds),
        "-c:v", "libx264",
        // Scale down to at most 1080p width before encoding. 4K clips from
        // Kling/Pixazo (3840×2160) at native resolution take 30–60 min on a
        // small VM; scaling to 1920×1080 reduces pixel count 4× and makes the
        // encode feasible. The -2 keeps the height divisible by 2.
        "-vf", filter,
        ...(timing?.normalize ? ["-video_track_timescale", "90000"] : []),
        "-preset", "ultrafast",
        "-crf", "23",
        "-threads", "2",
        "-an",
        "-movflags", "+faststart",
      ])
      .output(outputPath),
  );
}

async function extractThumbnailFromFile(
  videoPath: string,
  timestampSeconds: number,
  outputPath: string,
): Promise<void> {
  await runFfmpegWithTimeout(
    ffmpeg()
      .input(videoPath)
      .inputOptions(["-ss", String(Math.max(0, timestampSeconds))])
      .frames(1)
      .outputOptions(["-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2"])
      .output(outputPath),
  );
}

function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .slice(0, 120);
}

// Lyric-video mode: split the lyrics into lines and show them one at a time,
// evenly across the video, so they appear roughly in sync with the music.
// Returns a chained drawtext filter (one drawtext per line, time-gated).
function buildLyricsFilter(lyricsText: string, totalDuration: number): string {
  const lines = lyricsText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 60);
  if (lines.length === 0) return "";

  const dur = Math.max(1, totalDuration);
  const per = dur / lines.length;
  const style =
    "fontsize=34:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=12:" +
    "x=(w-text_w)/2:y=h-100";

  return lines
    .map((line, i) => {
      const start = (i * per).toFixed(2);
      const end = ((i + 1) * per).toFixed(2);
      return `drawtext=${style}:text='${escapeDrawtext(line)}':enable='between(t,${start},${end})'`;
    })
    .join(",");
}

export async function stitchVideoClips(input: StitchInput): Promise<StitchResult> {
  if (input.preserveEndFrame && !input.strictSequence) throw new Error("Ending-frame preservation requires a strict chronological sequence.");
  const tmpDir = join(tmpdir(), `bv_stitch_${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });

  const trimmedPaths: string[] = [];
  const concatListPath = join(tmpDir, "concat.txt");
  const hasAudio = !!(input.audioBuffer && input.audioExt);
  const audioPath = hasAudio ? join(tmpDir, `audio.${input.audioExt}`) : null;
  const stitchedPath = join(tmpDir, "stitched.mp4");
  const outputPath = join(tmpDir, "output.mp4");
  const thumbPath = join(tmpDir, "thumb.jpg");

  try {
    if (hasAudio && audioPath) await writeFile(audioPath, input.audioBuffer!);

    // Process each clip independently: if one is corrupt/unreadable, skip it and
    // keep going rather than failing the whole render.
    let skippedClips = 0;
    for (let i = 0; i < input.clips.length; i++) {
      const rawPath = join(tmpDir, `raw_${i}.mp4`);
      const trimmed = join(tmpDir, `clip_${i}.mp4`);
      try {
        await writeFile(rawPath, input.clips[i]!.buffer);
        const preserveEnd = !!input.preserveEndFrame && i === input.clips.length - 1;
        const targetDuration = preserveEnd
          ? input.totalDuration - input.clips.slice(0, i).reduce((sum, clip) => sum + clip.targetDuration, 0)
          : input.clips[i]!.targetDuration;
        if (targetDuration <= 0) throw new Error("Ending-frame timeline has no remaining duration.");
        await trimOrLoopClip(rawPath, trimmed, targetDuration, input.preserveEndFrame ? { normalize: true, preserveEnd } : undefined);
        trimmedPaths.push(trimmed);
      } catch (err) {
        skippedClips++;
        console.warn(`[stitch] skipping problematic clip ${i}:`, err instanceof Error ? err.message : err);
      } finally {
        await unlink(rawPath).catch(() => {});
      }
    }
    if (trimmedPaths.length === 0) {
      throw new Error("None of the clips could be processed, so no video could be stitched.");
    }

    const requestedSequence = input.sequence?.length
      ? input.sequence
      : input.clips.map((_, index) => index);
    if (
      input.strictSequence
      && (
        requestedSequence.length !== input.clips.length
        || requestedSequence.some((sourceIndex, index) => sourceIndex !== index)
      )
    ) {
      throw new Error("Strict stitching requires every clip exactly once in chronological order.");
    }
    const availableBySource = new Map<number, string>();
    for (const path of trimmedPaths) {
      const match = /clip_(\d+)\.mp4$/.exec(path);
      if (match) availableBySource.set(Number(match[1]), path);
    }
    const availableSourceIndexes = [...availableBySource.keys()].sort((a, b) => a - b);
    if (input.strictSequence && skippedClips > 0) {
      throw new Error(
        `Narrative stitching requires every planned scene, but ${skippedClips} scene clip(s) could not be processed.`,
      );
    }
    const resolvedSequence = input.strictSequence
      ? requestedSequence
      : resolveAvailableStitchSequence(
          requestedSequence,
          availableSourceIndexes,
          input.clips.length,
        );
    const editPaths = resolvedSequence.map((sourceIndex) => availableBySource.get(sourceIndex)!);
    const concatContent = editPaths.map((p) => `file '${p}'`).join("\n");
    await writeFile(concatListPath, concatContent);

    await runFfmpegWithTimeout(
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions([
          "-c:v", "copy",
          "-an",
          "-movflags", "+faststart",
        ])
        .output(stitchedPath),
    );

    const hasLyrics = !!input.lyricsText?.trim();
    const outputOptions = hasLyrics
      ? hasAudio
        ? [
            "-map", "0:v",
            "-map", "1:a",
            "-t", String(input.totalDuration),
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "22",
            "-threads", "2",
            "-c:a", "aac",
            "-b:a", "192k",
            // `-t totalDuration` above is the explicit timeline boundary.
            // `-shortest` would incorrectly end a remix when its source audio
            // has encoder padding or an early EOF.
            "-movflags", "+faststart",
          ]
        : [
            "-map", "0:v",
            "-an",
            "-t", String(input.totalDuration),
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "22",
            "-threads", "2",
            "-movflags", "+faststart",
          ]
      : hasAudio
        ? [
          "-map", "0:v",
          "-map", "1:a",
          "-t", String(input.totalDuration),
          // Every scene was normalized above, so attaching audio does not need
          // another full-video encode. Stream copy keeps peak memory flat and
          // turns the riskiest 12+ minute step into a quick mux.
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "192k",
          // Keep the visual timeline authoritative when attached audio is
          // shorter; `-shortest` would cut the video at audio EOF.
          "-movflags", "+faststart",
        ]
        : [
            "-map", "0:v",
            "-an",
            "-t", String(input.totalDuration),
            "-c:v", "copy",
            "-movflags", "+faststart",
          ];

    // Lyric mode: word-level karaoke via an ASS subtitle burn (libass). Falls
    // back to the v1 line-timed drawtext filter if the subtitles filter is
    // unavailable in the local ffmpeg build.
    let assPath: string | null = null;
    if (input.lyricsText?.trim()) {
      const timedLines = buildTimedLines(input.lyricsText, input.totalDuration);
      if (timedLines.length > 0) {
        assPath = join(tmpDir, "lyrics.ass");
        await writeFile(assPath, buildAssKaraoke(timedLines));
      }
    }

    const karaokeOptions = assPath
      ? [...outputOptions, "-vf", `subtitles=${assPath.replace(/([\\':])/g, "\\$1")}${fontsDirOpt()}`]
      : outputOptions;

    const buildCmd = (options: string[]) => {
      const cmd = ffmpeg().input(stitchedPath);
      if (hasAudio && audioPath) cmd.input(audioPath);
      return cmd.outputOptions(options).output(outputPath);
    };

    try {
      await runFfmpegWithTimeout(
        buildCmd(karaokeOptions),
        hasLyrics ? encodeTimeoutForDuration(input.totalDuration) : MIN_FFMPEG_TIMEOUT_MS,
      );
    } catch (err) {
      if (!assPath) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (/timed out|exceeded \d+ minutes/i.test(message)) throw err;
      // libass unavailable — retry with the simple drawtext lyric overlay.
      const fallbackOptions = [...outputOptions];
      const lyricsFilter = buildLyricsFilter(input.lyricsText!, input.totalDuration);
      if (lyricsFilter) fallbackOptions.push("-vf", lyricsFilter);
      await runFfmpegWithTimeout(
        buildCmd(fallbackOptions),
        encodeTimeoutForDuration(input.totalDuration),
      );
    }

    const thumbTimestamp = Math.max(1, input.totalDuration * 0.3);
    await extractThumbnailFromFile(outputPath, thumbTimestamp, thumbPath);

    const [videoBuffer, thumbnailBuffer] = await Promise.all([
      readFile(outputPath),
      readFile(thumbPath),
    ]);

    return { videoBuffer, thumbnailBuffer, skippedClips, resolvedSequence };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extractVideoThumbnail(
  videoBuffer: Buffer,
  timestampSeconds: number,
): Promise<Buffer> {
  const tmpDir = join(tmpdir(), `bv_thumb_${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
  const inPath = join(tmpDir, "input.mp4");
  const outPath = join(tmpDir, "thumb.jpg");
  try {
    await writeFile(inPath, videoBuffer);
    await extractThumbnailFromFile(inPath, timestampSeconds, outPath);
    return await readFile(outPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
