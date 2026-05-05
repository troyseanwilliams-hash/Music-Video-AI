import ffmpeg from "fluent-ffmpeg";
import { writeFile, readFile, unlink, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

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

function buildLyricsFilter(lyricsText: string): string {
  const escaped = lyricsText
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/\n/g, " ")
    .slice(0, 200);
  return (
    `drawtext=fontsize=32:fontcolor=white:` +
    `box=1:boxcolor=black@0.55:boxborderw=10:` +
    `x=(w-text_w)/2:y=h-90:` +
    `text='${escaped}'`
  );
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

    for (let i = 0; i < input.clips.length; i++) {
      const rawPath = join(tmpDir, `raw_${i}.mp4`);
      const trimmed = join(tmpDir, `clip_${i}.mp4`);
      await writeFile(rawPath, input.clips[i]!.buffer);
      await trimOrLoopClip(rawPath, trimmed, input.clips[i]!.targetDuration);
      await unlink(rawPath).catch(() => {});
      trimmedPaths.push(trimmed);
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
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      "-movflags", "+faststart",
    ];

    if (input.lyricsText?.trim()) {
      outputOptions.push("-vf", buildLyricsFilter(input.lyricsText));
    }

    await runFfmpeg(
      ffmpeg()
        .input(stitchedPath)
        .input(audioPath)
        .outputOptions(outputOptions)
        .output(outputPath),
    );

    const thumbTimestamp = Math.max(1, input.totalDuration * 0.3);
    await extractThumbnailFromFile(outputPath, thumbTimestamp, thumbPath);

    const [videoBuffer, thumbnailBuffer] = await Promise.all([
      readFile(outputPath),
      readFile(thumbPath),
    ]);

    return { videoBuffer, thumbnailBuffer };
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
