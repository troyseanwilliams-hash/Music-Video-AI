import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertStrictUniqueMedia,
  fingerprintsMatch,
  perceptualFingerprint,
  sha256Buffer,
  type MediaFingerprint,
} from "./mediaUniqueness.js";

const execFileAsync = promisify(execFile);

function ppm(pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const bytes: number[] = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) bytes.push(...pixel(x, y));
  }
  return Buffer.concat([Buffer.from("P6\n16 16\n255\n"), Buffer.from(bytes)]);
}

function synthetic(hash: string, bits: string, color: [number, number, number]): MediaFingerprint {
  return {
    exactHash: hash,
    frames: [{ luminanceBits: bits, meanRgb: color, luminanceStdDev: 30 }],
  };
}

describe("media uniqueness", () => {
  let videoDir: string;
  let baseVideo: Buffer;
  let gradedVideo: Buffer;
  let latterOverlapVideo: Buffer;
  let reversedVideo: Buffer;
  let mirroredVideo: Buffer;
  let distinctVideo: Buffer;

  beforeAll(async () => {
    videoDir = await mkdtemp(join(tmpdir(), "beatsync-unique-test-"));
    const basePath = join(videoDir, "base.mp4");
    const gradedPath = join(videoDir, "graded.mp4");
    const overlapPath = join(videoDir, "overlap.mp4");
    const reversedPath = join(videoDir, "reversed.mp4");
    const mirroredPath = join(videoDir, "mirrored.mp4");
    const distinctPath = join(videoDir, "distinct.mp4");
    const encode = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
    await execFileAsync("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12:duration=2.5",
      ...encode, basePath,
    ]);
    await execFileAsync("ffmpeg", [
      "-y", "-v", "error", "-i", basePath,
      "-vf", "lutrgb=r=val+25:g=val+25:b=val+25",
      ...encode, gradedPath,
    ]);
    await execFileAsync("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "smptebars=size=160x90:rate=12:duration=1",
      "-ss", "1", "-i", basePath,
      "-filter_complex",
      "[0:v]setpts=PTS-STARTPTS[a];[1:v]trim=duration=1.5,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v]",
      "-map", "[v]", ...encode, overlapPath,
    ]);
    await execFileAsync("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "mandelbrot=size=160x90:rate=12",
      "-t", "2.5", ...encode, distinctPath,
    ]);
    await execFileAsync("ffmpeg", [
      "-y", "-v", "error", "-i", basePath,
      "-vf", "reverse", ...encode, reversedPath,
    ]);
    await execFileAsync("ffmpeg", [
      "-y", "-v", "error", "-i", basePath,
      "-vf", "hflip", ...encode, mirroredPath,
    ]);
    [baseVideo, gradedVideo, latterOverlapVideo, reversedVideo, mirroredVideo, distinctVideo] = await Promise.all(
      [basePath, gradedPath, overlapPath, reversedPath, mirroredPath, distinctPath].map((path) => readFile(path)),
    );
  }, 30_000);

  afterAll(async () => {
    await rm(videoDir, { recursive: true, force: true });
  });

  it("SHA-256 identifies byte-exact duplicates", () => {
    const content = Buffer.from("same media");
    const hash = sha256Buffer(content);
    expect(hash).toBe(sha256Buffer(Buffer.from(content)));
    expect(sha256Buffer(content)).not.toBe(sha256Buffer(Buffer.from("different media")));
    const exactLeft = synthetic(hash, "0".repeat(256), [0, 0, 0]);
    const exactRight = synthetic(hash, "1".repeat(256), [255, 255, 255]);
    expect(fingerprintsMatch(exactLeft, exactRight)).toBe(true);
    expect(() => assertStrictUniqueMedia(true, [exactLeft, exactRight], "clip")).toThrow(
      "duplicate clip content",
    );
  });

  it("deterministically recognizes an obvious near-identical image", async () => {
    const base = ppm((x, y) => {
      const value = x * 10 + y * 3;
      return [value, value, value];
    });
    const lightlyAdjusted = ppm((x, y) => {
      const value = Math.min(255, x * 10 + y * 3 + (x === 0 && y === 0 ? 4 : 2));
      return [value, value, value];
    });
    const [left, repeated, right] = await Promise.all([
      perceptualFingerprint(base, "image"),
      perceptualFingerprint(base, "image"),
      perceptualFingerprint(lightlyAdjusted, "image"),
    ]);
    expect(repeated).toEqual(left);
    expect(fingerprintsMatch(left, right)).toBe(true);
  });

  it("samples the full video and recognizes a globally graded re-encode", async () => {
    const [base, graded] = await Promise.all([
      perceptualFingerprint(baseVideo, "video"),
      perceptualFingerprint(gradedVideo, "video"),
    ]);
    expect(base.frames).toHaveLength(9);
    expect(graded.frames).toHaveLength(9);
    expect(base.exactHash).not.toBe(graded.exactHash);
    expect(fingerprintsMatch(base, graded)).toBe(true);
  });

  it("detects footage reused only in the latter sixty percent", async () => {
    const [base, overlap] = await Promise.all([
      perceptualFingerprint(baseVideo, "video"),
      perceptualFingerprint(latterOverlapVideo, "video"),
    ]);
    expect(base.exactHash).not.toBe(overlap.exactHash);
    expect(fingerprintsMatch(base, overlap)).toBe(true);
  });

  it("detects a temporally reversed re-encode as reused footage", async () => {
    const [base, reversed] = await Promise.all([
      perceptualFingerprint(baseVideo, "video"),
      perceptualFingerprint(reversedVideo, "video"),
    ]);
    expect(base.exactHash).not.toBe(reversed.exactHash);
    expect(fingerprintsMatch(base, reversed)).toBe(true);
  });

  it("detects a spatially mirrored re-encode as reused footage", async () => {
    const [base, mirrored] = await Promise.all([
      perceptualFingerprint(baseVideo, "video"),
      perceptualFingerprint(mirroredVideo, "video"),
    ]);
    expect(base.exactHash).not.toBe(mirrored.exactHash);
    expect(fingerprintsMatch(base, mirrored)).toBe(true);
  });

  it("keeps structurally distinct videos separate", async () => {
    const [base, distinct] = await Promise.all([
      perceptualFingerprint(baseVideo, "video"),
      perceptualFingerprint(distinctVideo, "video"),
    ]);
    expect(fingerprintsMatch(base, distinct)).toBe(false);
  });

  it("does not collapse visually distinct media", () => {
    const light = synthetic("a", "0".repeat(256), [30, 30, 30]);
    const different = synthetic("b", "1".repeat(256), [210, 40, 150]);
    expect(fingerprintsMatch(light, different)).toBe(false);
    expect(() => assertStrictUniqueMedia(true, [light, different], "clip")).not.toThrow();
  });

  it("recognizes the same non-flat structure after a strong global contrast grade", () => {
    const bits = `${"00110110".repeat(32)}`;
    const original: MediaFingerprint = {
      exactHash: "original",
      frames: [{ luminanceBits: bits, meanRgb: [128, 128, 128], luminanceStdDev: 20 }],
    };
    const highContrast: MediaFingerprint = {
      exactHash: "high-contrast",
      frames: [{ luminanceBits: bits, meanRgb: [128, 128, 128], luminanceStdDev: 45 }],
    };
    expect(fingerprintsMatch(original, highContrast)).toBe(true);
  });

  it("does not equate unrelated flat-color frames", () => {
    const dark: MediaFingerprint = {
      exactHash: "dark",
      frames: [{
        luminanceBits: "1".repeat(256),
        meanRgb: [20, 20, 20],
        luminanceStdDev: 0,
      }],
    };
    const bright: MediaFingerprint = {
      exactHash: "bright",
      frames: [{
        luminanceBits: "1".repeat(256),
        meanRgb: [220, 220, 220],
        luminanceStdDev: 0,
      }],
    };
    expect(fingerprintsMatch(dark, bright)).toBe(false);
  });

  it("enforces duplicate guards only for strict jobs", () => {
    const first = synthetic("a", "0".repeat(256), [80, 80, 80]);
    const near = synthetic("b", `${"1".repeat(5)}${"0".repeat(251)}`, [84, 82, 80]);
    expect(() => assertStrictUniqueMedia(true, [first, near], "source image")).toThrow(
      "duplicate source image content",
    );
    expect(() => assertStrictUniqueMedia(false, [first, near], "source image")).not.toThrow();
  });

  it("keeps API and worker implementations byte-identical", async () => {
    const [apiSource, workerSource] = await Promise.all([
      readFile(new URL("./mediaUniqueness.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../worker/src/lib/mediaUniqueness.ts", import.meta.url), "utf8"),
    ]);
    expect(workerSource).toBe(apiSource);
  });
});