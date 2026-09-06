import { createHash, randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { withResourceLease } from "@workspace/db";

const execFileAsync = promisify(execFile);
const SIDE = 16;
const FRAME_BYTES = SIDE * SIDE * 3;

export type PerceptualFrame = {
  luminanceBits: string;
  meanRgb: [number, number, number];
  luminanceStdDev: number;
};

export type MediaFingerprint = {
  exactHash: string;
  frames: PerceptualFrame[];
};

export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function fingerprintRgbFrames(raw: Buffer): PerceptualFrame[] {
  const frames: PerceptualFrame[] = [];
  for (let offset = 0; offset + FRAME_BYTES <= raw.length; offset += FRAME_BYTES) {
    const luminance: number[] = [];
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let pixel = 0; pixel < SIDE * SIDE; pixel++) {
      const index = offset + pixel * 3;
      const r = raw[index]!;
      const g = raw[index + 1]!;
      const b = raw[index + 2]!;
      red += r;
      green += g;
      blue += b;
      luminance.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
    const average = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
    const variance = luminance.reduce(
      (sum, value) => sum + Math.pow(value - average, 2),
      0,
    ) / luminance.length;
    frames.push({
      luminanceBits: luminance.map((value) => value >= average ? "1" : "0").join(""),
      meanRgb: [
        Math.round(red / luminance.length),
        Math.round(green / luminance.length),
        Math.round(blue / luminance.length),
      ],
      luminanceStdDev: Math.round(Math.sqrt(variance) * 100) / 100,
    });
  }
  return frames;
}

export async function perceptualFingerprint(
  buffer: Buffer,
  kind: "image" | "video",
): Promise<MediaFingerprint> {
  const inputPath = join(tmpdir(), `beatsync-unique-${randomUUID()}.media`);
  try {
    await writeFile(inputPath, buffer);
    let duration = 0;
    if (kind === "video") {
      const { stdout } = await withResourceLease("ffmpeg_light", ({ signal }) => execFileAsync(
        "ffprobe",
        [
          "-v", "error", "-select_streams", "v:0",
          "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1",
          inputPath,
        ],
        { timeout: 15_000, encoding: "utf8", maxBuffer: 64 * 1024, signal },
      ));
      duration = Number.parseFloat(stdout);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("video duration could not be determined");
      }
    }
    const videoSampleCount = 9;
    const filters = [
      "scale=16:16:force_original_aspect_ratio=decrease",
      "pad=16:16:(ow-iw)/2:(oh-ih)/2",
      // fps places samples throughout the whole timeline (including its final
      // interval), unlike taking the first N decoded frames.
      ...(kind === "video" ? [`fps=${videoSampleCount}/${duration}`] : []),
    ].join(",");
    const { stdout } = await withResourceLease("ffmpeg_heavy", ({ signal }) => execFileAsync(
      "ffmpeg",
      [
        "-v", "error", "-i", inputPath,
        "-map", "0:v:0", "-vf", filters,
        "-frames:v", kind === "video" ? String(videoSampleCount) : "1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
      ],
      { timeout: 45_000, encoding: "buffer", maxBuffer: FRAME_BYTES * 16, signal },
    ));
    const frames = fingerprintRgbFrames(stdout as Buffer);
    if (frames.length === 0) throw new Error("media contains no decodable visual frame");
    if (kind === "video" && frames.length < 8) {
      throw new Error("video did not yield enough distributed visual samples");
    }
    return { exactHash: sha256Buffer(buffer), frames };
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) distance++;
  }
  return distance;
}

function spatialBitVariants(bits: string): string[] {
  if (bits.length !== SIDE * SIDE) return [bits];
  const transforms: Array<(x: number, y: number) => [number, number]> = [
    (x, y) => [x, y],
    (x, y) => [SIDE - 1 - x, y],
    (x, y) => [x, SIDE - 1 - y],
    (x, y) => [SIDE - 1 - x, SIDE - 1 - y],
    (x, y) => [y, x],
    (x, y) => [SIDE - 1 - y, x],
    (x, y) => [y, SIDE - 1 - x],
    (x, y) => [SIDE - 1 - y, SIDE - 1 - x],
  ];
  return transforms.map((transform) => {
    let transformed = "";
    for (let y = 0; y < SIDE; y++) {
      for (let x = 0; x < SIDE; x++) {
        const [sourceX, sourceY] = transform(x, y);
        transformed += bits[sourceY * SIDE + sourceX]!;
      }
    }
    return transformed;
  });
}

function framesNear(left: PerceptualFrame, right: PerceptualFrame): boolean {
  const colorDistance = Math.max(
    ...left.meanRgb.map((value, index) => Math.abs(value - right.meanRgb[index]!)),
  );
  const maxContrast = Math.max(left.luminanceStdDev, right.luminanceStdDev);
  const bothNearlyFlat = maxContrast < 4;
  // Mean-threshold structure is invariant to global brightness and most color
  // grades. Compare every square-image symmetry so mirrored and rotated copies
  // cannot masquerade as distinct scenes. Flat frames have no useful structure,
  // so only consider those equal when their actual colors are also close.
  const structuralDistance = Math.min(
    ...spatialBitVariants(right.luminanceBits).map((variant) =>
      hammingDistance(left.luminanceBits, variant),
    ),
  );
  return structuralDistance <= 14
    && (!bothNearlyFlat || colorDistance <= 12);
}

function maximumUnorderedFrameMatches(
  left: PerceptualFrame[],
  right: PerceptualFrame[],
): number {
  const matchedLeftByRight = new Array<number>(right.length).fill(-1);
  const tryMatch = (leftIndex: number, visitedRight: boolean[]): boolean => {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
      if (
        visitedRight[rightIndex]
        || !framesNear(left[leftIndex]!, right[rightIndex]!)
      ) {
        continue;
      }
      visitedRight[rightIndex] = true;
      if (
        matchedLeftByRight[rightIndex] === -1
        || tryMatch(matchedLeftByRight[rightIndex]!, visitedRight)
      ) {
        matchedLeftByRight[rightIndex] = leftIndex;
        return true;
      }
    }
    return false;
  };

  let matches = 0;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex++) {
    if (tryMatch(leftIndex, new Array<boolean>(right.length).fill(false))) {
      matches++;
    }
  }
  return matches;
}

export function fingerprintsMatch(
  left: MediaFingerprint,
  right: MediaFingerprint,
): boolean {
  if (left.exactHash === right.exactHash) return true;
  const comparedFrames = Math.min(left.frames.length, right.frames.length);
  if (comparedFrames === 0) return false;
  if (comparedFrames === 1) return framesNear(left.frames[0]!, right.frames[0]!);

  // Longest-common-subsequence matching tolerates a shifted edit while still
  // preserving temporal order. Requiring a majority catches clips which reuse
  // roughly the latter 60%, without declaring a shared opening frame duplicate.
  const rows = left.frames.length + 1;
  const columns = right.frames.length + 1;
  const matches = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let l = 1; l < rows; l++) {
    for (let r = 1; r < columns; r++) {
      matches[l]![r] = framesNear(left.frames[l - 1]!, right.frames[r - 1]!)
        ? matches[l - 1]![r - 1]! + 1
        : Math.max(matches[l - 1]![r]!, matches[l]![r - 1]!);
    }
  }
  const duplicateThreshold = Math.ceil(comparedFrames * 0.55);
  if (matches[left.frames.length]![right.frames.length]! >= duplicateThreshold) {
    return true;
  }

  // Reversed, speed-shifted, or reordered copies reuse the same visual frames
  // without preserving temporal order. A maximum one-to-one bipartite match
  // catches that substantial overlap without allowing one repeated frame to
  // count multiple times.
  return maximumUnorderedFrameMatches(left.frames, right.frames) >= duplicateThreshold;
}

export function assertStrictUniqueMedia(
  strict: boolean,
  fingerprints: MediaFingerprint[],
  mediaLabel: string,
): void {
  if (!strict) return;
  const pair = findDuplicateMediaPair(fingerprints);
  if (pair) {
    throw new Error(`Strict job contains duplicate ${mediaLabel} content at positions ${pair.left + 1} and ${pair.right + 1}`);
  }
}

export function findDuplicateMediaPair(
  fingerprints: MediaFingerprint[],
): { left: number; right: number } | null {
  for (let right = 1; right < fingerprints.length; right++) {
    for (let left = 0; left < right; left++) {
      if (fingerprintsMatch(fingerprints[left]!, fingerprints[right]!)) {
        return { left, right };
      }
    }
  }
  return null;
}
