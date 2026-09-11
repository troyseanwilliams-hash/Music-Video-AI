import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  compensatedTransitionBodyRange,
  crossfadeEditorTimelineDuration,
  editorMusicTempPaths,
  intendedEditorTimelineDuration,
  stitchEditorTimeline,
} from "./editorStitcher.js";

function makeRegressionVideo(videoDuration: number, audioDuration: number, frequency: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=30:duration=${videoDuration}`,
      "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${audioDuration}`,
      "-map", "0:v:0", "-map", "1:a:0", "-t", String(videoDuration),
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-r", "30", "-frames:v", String(Math.max(1, Math.round(videoDuration * 30))),
      "-c:a", "aac", "-ar", "48000", "-ac", "2",
      "-movflags", "+frag_keyframe+empty_moov", "-f", "mp4", "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg regression fixture failed (${code}): ${Buffer.concat(errors).toString()}`));
    });
  });
}

function makeMarkerVideo(color: string, videoDuration: number, frequency: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=${color}:size=320x180:rate=30:duration=${videoDuration}`,
      "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${videoDuration}`,
      "-map", "0:v:0", "-map", "1:a:0", "-t", String(videoDuration),
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-r", "30", "-frames:v", String(Math.max(1, Math.round(videoDuration * 30))),
      "-c:a", "aac", "-ar", "48000", "-ac", "2",
      "-movflags", "+frag_keyframe+empty_moov", "-f", "mp4", "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg marker fixture failed (${code}): ${Buffer.concat(errors).toString()}`));
    });
  });
}

function probePrimaryVideo(buffer: Buffer): Promise<{ duration: number; frames: number }> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-count_frames", "-show_entries", "stream=duration,nb_read_frames",
      "-of", "json", "pipe:0",
    ]);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    ffprobe.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffprobe.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    ffprobe.on("error", reject);
    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe regression probe failed (${code}): ${Buffer.concat(errors).toString()}`));
        return;
      }
      const stream = JSON.parse(Buffer.concat(chunks).toString()).streams?.[0];
      resolve({
        duration: Number(stream?.duration),
        frames: Number(stream?.nb_read_frames),
      });
    });
    ffprobe.stdin.end(buffer);
  });
}

function extractRgbFrame(buffer: Buffer, timestamp: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
      "-ss", timestamp.toFixed(3), "-frames:v", "1",
      "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg frame probe failed (${code}): ${Buffer.concat(errors).toString()}`));
    });
    ffmpeg.stdin.end(buffer);
  });
}

describe("editor music temporary paths", () => {
  it("keeps an MP4 music input distinct from the MP4 render output", () => {
    const paths = editorMusicTempPaths("/tmp/editor-job", "mp4");

    expect(paths.inputPath).toBe("/tmp/editor-job/music-input.mp4");
    expect(paths.outputPath).toBe("/tmp/editor-job/with-music.mp4");
    expect(paths.inputPath).not.toBe(paths.outputPath);
  });

  it("normalizes valid extensions and rejects path-like extensions", () => {
    expect(editorMusicTempPaths("/tmp/editor-job", "M4A").inputPath).toBe(
      "/tmp/editor-job/music-input.m4a",
    );
    expect(
      editorMusicTempPaths("/tmp/editor-job", "../../music.mp4").inputPath,
    ).toBe("/tmp/editor-job/music-input.mp3");
  });
});

describe("editor timeline durations", () => {
  it("keeps the additive timeline separate from xfade's overlapping runtime", () => {
    const segmentDurations = [10, 8, 8];

    expect(intendedEditorTimelineDuration(segmentDurations)).toBe(26);
    expect(crossfadeEditorTimelineDuration(segmentDurations, 0.5)).toBe(26);
  });

  it("ignores invalid durations instead of shortening a valid timeline", () => {
    expect(intendedEditorTimelineDuration([4, Number.NaN, -2, 3])).toBe(7);
    expect(crossfadeEditorTimelineDuration([4, Number.NaN, 3], 0.5)).toBe(7);
  });

  it("distributes 15-scene transition compensation at each boundary", () => {
    const segmentDurations = [10, ...Array.from({ length: 14 }, () => 115 / 14)];
    const transitionDuration = 0.5;
    const ranges = segmentDurations.map((duration, index) =>
      compensatedTransitionBodyRange(index, duration, transitionDuration),
    );
    const bodyDuration = ranges.reduce(
      (sum, range) => sum + range.endSec - range.startSec,
      0,
    );
    const transitionDurationTotal = (ranges.length - 1) * transitionDuration;

    expect(intendedEditorTimelineDuration(segmentDurations)).toBeCloseTo(125, 6);
    expect(bodyDuration + transitionDurationTotal).toBeCloseTo(125, 6);
    expect(ranges[0]).toEqual({ startSec: 0, endSec: 10 });
    expect(ranges[1]?.startSec).toBe(transitionDuration);
    expect(ranges[14]?.endSec).toBeCloseTo(115 / 14, 6);
    // The old tail-only compensation would leave 7 seconds at the end.
    expect(transitionDurationTotal).toBe(7);

    const secondTimeline = [10, ...Array.from({ length: 14 }, () => 117 / 14)];
    expect(crossfadeEditorTimelineDuration(secondTimeline, 0.6)).toBeCloseTo(127, 6);
    expect(
      secondTimeline.reduce(
        (sum, duration, index) =>
          sum + compensatedTransitionBodyRange(index, duration, 0.6).endSec -
            compensatedTransitionBodyRange(index, duration, 0.6).startSec,
        0,
      ) + 14 * 0.6,
    ).toBeCloseTo(127, 6);
  });

  it("renders moving videos with short/long tones and disables tiny-clip transitions", async () => {
    const [shortTone, longTone] = await Promise.all([
      makeRegressionVideo(1.2, 0.4, 440),
      makeRegressionVideo(1.4, 2, 880),
    ]);
    const mixed = await stitchEditorTimeline({
      segments: [
        { buffer: shortTone, kind: "video", durationSec: 0, ext: "mp4" },
        { buffer: longTone, kind: "video", durationSec: 0, ext: "mp4" },
      ],
      transition: { type: "dissolve", durationSec: 0.4 },
      width: 320,
      height: 180,
      fps: 30,
    });

    expect(mixed.transitionsDisabled).not.toBe(true);
    // Fragmented MP4 fixtures carry the encoder-delay PTS in their primary
    // video stream; the stitcher must preserve that probed visual duration,
    // not truncate to either tone's shorter/longer audio stream.
    expect(mixed.durationSeconds).toBeCloseTo(2.6667, 2);

    const tiny = await makeRegressionVideo(0.05, 0.05, 660);
    const tinyResult = await stitchEditorTimeline({
      segments: [
        { buffer: tiny, kind: "video", durationSec: 0, ext: "mp4" },
        { buffer: tiny, kind: "video", durationSec: 0, ext: "mp4" },
      ],
      transition: { type: "dissolve", durationSec: 0.4 },
      width: 320,
      height: 180,
      fps: 30,
    });
    expect(tinyResult.transitionsDisabled).toBe(true);
    expect(tinyResult.durationSeconds).toBeGreaterThan(0);
    expect(tinyResult.durationSeconds).toBeLessThan(0.2);
  }, 120_000);

  it("quantizes .35s transitions across many clips and preserves the final marker frame", async () => {
    const clips = await Promise.all(
      Array.from({ length: 9 }, (_, index) =>
        makeMarkerVideo(index === 8 ? "red" : "blue", 0.9, 440 + index * 20),
      ),
    );
    const sourceStats = await Promise.all(clips.map(probePrimaryVideo));
    const expectedFrames = Math.round(
      sourceStats.reduce((sum, stats) => sum + stats.duration, 0) * 30,
    );
    const result = await stitchEditorTimeline({
      segments: clips.map((buffer) => ({
        buffer,
        kind: "video" as const,
        durationSec: 0,
        ext: "mp4",
      })),
      transition: { type: "dissolve", durationSec: 0.35 },
      width: 320,
      height: 180,
      fps: 30,
    });

    const outputStats = await probePrimaryVideo(result.videoBuffer);
    expect(result.transitionsDisabled).not.toBe(true);
    expect(outputStats.frames).toBe(expectedFrames);
    expect(result.durationSeconds).toBeCloseTo(expectedFrames / 30, 6);

    const finalFrame = await extractRgbFrame(result.videoBuffer, result.durationSeconds - 0.02);
    let red = 0;
    let blue = 0;
    for (let i = 0; i + 2 < finalFrame.length; i += 3) {
      red += finalFrame[i]!;
      blue += finalFrame[i + 2]!;
    }
    expect(red).toBeGreaterThan(blue * 1.5);
  }, 120_000);
});