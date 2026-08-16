// Burns karaoke lyrics onto an existing finished video, producing a new MP4.
// Same timing engine as generation (lyricTiming.ts): plain text, LRC line
// timestamps, or word-level enhanced LRC.

import ffmpeg from "fluent-ffmpeg";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { buildTimedLines, buildAssKaraoke, karaokeFontsDir } from "./lyricTiming.js";

// `:fontsdir=` option pointing libass at the bundled karaoke font (Archivo
// Black); empty string when the font directory is missing.
function fontsDirOpt(): string {
  const dir = karaokeFontsDir();
  return dir ? `:fontsdir=${dir.replace(/([\\':])/g, "\\$1")}` : "";
}


function runFfmpeg(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd.on("end", () => resolve()).on("error", (err) => reject(err)).run();
  });
}

/**
 * Returns the video with karaoke captions burned in. Throws if the lyrics
 * produce no timed lines or the burn fails (caller refunds on failure).
 */
export async function burnLyricsOnVideo(
  videoBuffer: Buffer,
  lyricsText: string,
  durationSeconds: number,
): Promise<Buffer> {
  const timedLines = buildTimedLines(lyricsText, Math.max(1, durationSeconds));
  if (timedLines.length === 0) {
    throw new Error("No usable lyric lines found");
  }

  const tmpDir = join(tmpdir(), `bv_lyrics_${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
  const srcPath = join(tmpDir, "src.mp4");
  const assPath = join(tmpDir, "lyrics.ass");
  const outPath = join(tmpDir, "out.mp4");

  try {
    await writeFile(srcPath, videoBuffer);
    await writeFile(assPath, buildAssKaraoke(timedLines));
    await runFfmpeg(
      ffmpeg()
        .input(srcPath)
        .outputOptions([
          "-vf", `subtitles=${assPath.replace(/([\\':])/g, "\\$1")}${fontsDirOpt()}`,
          "-c:v", "libx264",
          "-preset", "fast",
          "-crf", "22",
          "-threads", "2",
          "-pix_fmt", "yuv420p",
          "-c:a", "copy",
          "-movflags", "+faststart",
        ])
        .output(outPath),
    );
    return await readFile(outPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
