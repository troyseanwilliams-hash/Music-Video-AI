import ffmpeg from "fluent-ffmpeg";
import { writeFile, readFile, unlink, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { buildTimedLines, buildAssKaraoke } from "./lyricTiming.js";

export interface StitchInput {
  clips: { buffer: Buffer; targetDuration: number }[];
  audioBuffer: Buffer;
  audioExt: string;
  totalDuration: number;
  lyricsText?: string;
}

export interface StitchResult {
  videoBuffer: Buffer;
  thumbnailBuffer: Buffer;
  skippedClips: number; // clips left out because they couldn't be processed
}

function runFfmpeg(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd.on("end", () => resolve()).on("error", (err) => reject(err)).run();
  });
}

async function trimOrLoopClip(
  inputPath: string,
  outputPath: string,
  targetSeconds: number,
): Promise<void> {
  await runFfmpeg(
    ffmpeg()
      .input(inputPath)
      .inputOptions(["-stream_loop", "-1"])
      .outputOptions([
        "-t", String(targetSeconds),
        "-c:v", "libx264",
        "-preset", "fast",
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
  await runFfmpeg(
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
  const tmpDir = join(tmpdir(), `bv_stitch_${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });

  const trimmedPaths: string[] = [];
  const concatListPath = join(tmpDir, "concat.txt");
  const audioPath = join(tmpDir, `audio.${input.audioExt}`);
  const stitchedPath = join(tmpDir, "stitched.mp4");
  const outputPath = join(tmpDir, "output.mp4");
  const thumbPath = join(tmpDir, "thumb.jpg");

  try {
    await writeFile(audioPath, input.audioBuffer);

    // Process each clip independently: if one is corrupt/unreadable, skip it and
    // keep going rather than failing the whole render.
    let skippedClips = 0;
    for (let i = 0; i < input.clips.length; i++) {
      const rawPath = join(tmpDir, `raw_${i}.mp4`);
      const trimmed = join(tmpDir, `clip_${i}.mp4`);
      try {
        await writeFile(rawPath, input.clips[i]!.buffer);
        await trimOrLoopClip(rawPath, trimmed, input.clips[i]!.targetDuration);
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

    const concatContent = trimmedPaths.map((p) => `file '${p}'`).join("\n");
    await writeFile(concatListPath, concatContent);

    await runFfmpeg(
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions([
          "-c:v", "libx264",
          "-preset", "fast",
          "-crf", "23",
          "-threads", "2",
          "-an",
          "-movflags", "+faststart",
        ])
        .output(stitchedPath),
    );

    const outputOptions = [
      "-map", "0:v",
      "-map", "1:a",
      "-t", String(input.totalDuration),   // hard cap — guarantees correct duration
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "22",
      "-threads", "2",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
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
      ? [...outputOptions, "-vf", `subtitles=${assPath.replace(/([\\':])/g, "\\$1")}`]
      : outputOptions;

    try {
      await runFfmpeg(
        ffmpeg()
          .input(stitchedPath)
          .input(audioPath)
          .outputOptions(karaokeOptions)
          .output(outputPath),
      );
    } catch (err) {
      if (!assPath) throw err;
      // libass unavailable — retry with the simple drawtext lyric overlay.
      const fallbackOptions = [...outputOptions];
      const lyricsFilter = buildLyricsFilter(input.lyricsText!, input.totalDuration);
      if (lyricsFilter) fallbackOptions.push("-vf", lyricsFilter);
      await runFfmpeg(
        ffmpeg()
          .input(stitchedPath)
          .input(audioPath)
          .outputOptions(fallbackOptions)
          .output(outputPath),
      );
    }

    const thumbTimestamp = Math.max(1, input.totalDuration * 0.3);
    await extractThumbnailFromFile(outputPath, thumbTimestamp, thumbPath);

    const [videoBuffer, thumbnailBuffer] = await Promise.all([
      readFile(outputPath),
      readFile(thumbPath),
    ]);

    return { videoBuffer, thumbnailBuffer, skippedClips };
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
