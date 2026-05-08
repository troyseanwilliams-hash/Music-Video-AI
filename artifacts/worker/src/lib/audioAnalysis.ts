import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);

const SAMPLE_RATE = 22050;
const HOP = 512;

export interface AudioSection {
  startTime: number;
  endTime: number;
  label: string;
  energy: number;
}

export interface AudioAnalysis {
  bpm: number;
  key: string;
  energy: number;
  mood: string;
  durationSeconds: number;
  beatTimestamps: number[];
  sections: AudioSection[];
  beatGrid: number[];
}

async function decodeAudioToPCM(
  buffer: Buffer,
  ext: string,
): Promise<{ samples: Float32Array; duration: number }> {
  const id = randomUUID();
  const inFile = join(tmpdir(), `bv_in_${id}.${ext}`);
  const outFile = join(tmpdir(), `bv_out_${id}.pcm`);

  await writeFile(inFile, buffer);

  try {
    const { stdout: probeOut } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${inFile}"`,
      { timeout: 15_000 },
    ).catch(() => ({ stdout: "0" }));

    const duration = parseFloat(probeOut.trim()) || 0;

    await execAsync(
      `ffmpeg -y -loglevel error -i "${inFile}" -f f32le -acodec pcm_f32le -ar ${SAMPLE_RATE} -ac 1 "${outFile}"`,
      { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 },
    );

    const raw = await readFile(outFile);
    const samples = new Float32Array(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    );

    return {
      samples,
      duration: duration > 0 ? duration : samples.length / SAMPLE_RATE,
    };
  } finally {
    await unlink(inFile).catch(() => {});
    await unlink(outFile).catch(() => {});
  }
}

function computeRMS(samples: Float32Array): Float32Array {
  const n = Math.floor(samples.length / HOP);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const start = i * HOP;
    for (let j = start; j < Math.min(samples.length, start + HOP); j++) {
      s += (samples[j] ?? 0) * (samples[j] ?? 0);
    }
    rms[i] = Math.sqrt(s / HOP);
  }
  return rms;
}

function estimateBPM(rms: Float32Array): number {
  const step = 4;
  const reduced: number[] = [];
  for (let i = 0; i < rms.length; i += step) reduced.push(rms[i] ?? 0);

  const effectiveRate = SAMPLE_RATE / HOP / step;
  const minLag = Math.floor((effectiveRate * 60) / 200);
  const maxLag = Math.floor((effectiveRate * 60) / 60);

  let bestBPM = 120;
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i < reduced.length - lag; i++) {
      score += (reduced[i] ?? 0) * (reduced[i + lag] ?? 0);
    }
    score /= reduced.length - lag;
    if (score > bestScore) {
      bestScore = score;
      bestBPM = (60 * effectiveRate) / lag;
    }
  }

  return Math.round(Math.max(60, Math.min(200, bestBPM)) * 2) / 2;
}

function smoothArray(arr: number[], w: number): number[] {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - w), Math.min(arr.length, i + w + 1));
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function detectSections(rms: Float32Array, duration: number): AudioSection[] {
  const smoothed = smoothArray(Array.from(rms), Math.floor((2 * SAMPLE_RATE) / HOP));
  const maxE = Math.max(...smoothed, 1e-10);
  const normed = smoothed.map((e) => e / maxE);

  const targetSections =
    duration < 90 ? 3 : duration < 180 ? 4 : duration < 270 ? 5 : 6;
  const framesPerSection = Math.floor(rms.length / targetSections);

  const SECTION_LABELS = ["intro", "verse", "chorus", "bridge", "drop", "outro"];

  return Array.from({ length: targetSections }, (_, i) => {
    const sf = i * framesPerSection;
    const ef = Math.min(rms.length - 1, (i + 1) * framesPerSection);
    const startTime = Math.round(((sf * HOP) / SAMPLE_RATE) * 100) / 100;
    const endTime = Math.round(Math.min((ef * HOP) / SAMPLE_RATE, duration) * 100) / 100;
    const slice = normed.slice(sf, ef);
    const energy =
      slice.length > 0
        ? Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 100) / 100
        : 0;
    return { startTime, endTime, label: SECTION_LABELS[i % SECTION_LABELS.length]!, energy };
  });
}

function makeBeatTimestamps(bpm: number, duration: number): number[] {
  const interval = 60 / bpm;
  const beats: number[] = [];
  for (let t = 0; t < duration; t += interval) {
    beats.push(Math.round(t * 1000) / 1000);
  }
  return beats.slice(0, 500);
}

function guessKey(samples: Float32Array): string {
  const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const MODES = ["major", "minor"];
  const segment = samples.slice(0, Math.min(samples.length, SAMPLE_RATE));
  const sum = Array.from(segment).reduce((a, b) => a + Math.abs(b), 0);
  const keyIdx = Math.abs(Math.floor((sum * 1000) % 12));
  const modeIdx = Math.abs(Math.floor((sum * 100) % 2));
  return `${KEYS[keyIdx] ?? "C"} ${MODES[modeIdx] ?? "major"}`;
}

function determineMood(energy: number, bpm: number): string {
  if (energy > 0.7 && bpm > 130) return "euphoric";
  if (energy > 0.7 && bpm > 100) return "energetic";
  if (energy > 0.55 && bpm > 90) return "uplifting";
  if (energy > 0.5 && bpm > 120) return "intense";
  if (energy < 0.35 && bpm < 90) return "melancholic";
  if (energy < 0.45 && bpm < 100) return "chill";
  if (bpm > 150) return "dark";
  return "dreamy";
}

export async function analyzeAudioBuffer(
  buffer: Buffer,
  ext = "mp3",
): Promise<AudioAnalysis> {
  const { samples, duration } = await decodeAudioToPCM(buffer, ext);
  const rms = computeRMS(samples);

  const bpm = estimateBPM(rms);
  const beats = makeBeatTimestamps(bpm, duration);
  const sections = detectSections(rms, duration);

  const rmsArr = Array.from(rms);
  const meanRMS = rmsArr.reduce((a, b) => a + b, 0) / (rms.length || 1);
  const maxRMS = Math.max(...rmsArr, 1e-10);
  const energy = Math.min(1, (meanRMS / maxRMS) * 2.5);

  return {
    bpm: Math.round(bpm * 10) / 10,
    key: guessKey(samples),
    energy: Math.round(energy * 100) / 100,
    mood: determineMood(energy, bpm),
    durationSeconds: Math.round(duration * 100) / 100,
    beatTimestamps: beats,
    sections,
    beatGrid: beats.filter((_, i) => i % 4 === 0).slice(0, 100),
  };
}
