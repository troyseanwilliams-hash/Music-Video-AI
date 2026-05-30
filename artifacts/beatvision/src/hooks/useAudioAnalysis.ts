import { useState, useEffect } from "react";

export interface AudioAnalysisResult {
  bpm: number;
  energy: number;
  mood: string;
  dominantSection: string;
  durationSeconds: number;
}

export type AudioAnalysisState =
  | { status: "idle" }
  | { status: "analyzing" }
  | { status: "done"; result: AudioAnalysisResult }
  | { status: "error"; message: string };

const HOP = 512;
const SECTION_LABELS = ["intro", "verse", "chorus", "bridge", "drop", "outro"];

function computeRMS(channelData: Float32Array): Float32Array {
  const n = Math.floor(channelData.length / HOP);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const start = i * HOP;
    for (let j = start; j < Math.min(channelData.length, start + HOP); j++) {
      s += (channelData[j] ?? 0) ** 2;
    }
    rms[i] = Math.sqrt(s / HOP);
  }
  return rms;
}

function estimateBPM(rms: Float32Array, sampleRate: number): number {
  const step = 4;
  const reduced: number[] = [];
  for (let i = 0; i < rms.length; i += step) reduced.push(rms[i] ?? 0);
  const effectiveRate = sampleRate / HOP / step;
  const minLag = Math.floor((effectiveRate * 60) / 200);
  const maxLag = Math.floor((effectiveRate * 60) / 60);
  let bestBPM = 120;
  let bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i < reduced.length - lag; i++) {
      score += (reduced[i] ?? 0) * (reduced[i + lag] ?? 0);
    }
    score /= (reduced.length - lag) || 1;
    if (score > bestScore) {
      bestScore = score;
      bestBPM = (60 * effectiveRate) / lag;
    }
  }
  return Math.round(Math.max(60, Math.min(200, bestBPM)) * 2) / 2;
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

function findDominantSection(rmsArr: number[], duration: number): string {
  const targetSections = duration < 90 ? 3 : duration < 180 ? 4 : duration < 270 ? 5 : 6;
  const framesPerSection = Math.floor(rmsArr.length / targetSections);
  let dominant = "chorus";
  let maxEnergy = -1;
  for (let i = 0; i < targetSections; i++) {
    const sf = i * framesPerSection;
    const ef = Math.min(rmsArr.length, (i + 1) * framesPerSection);
    const slice = rmsArr.slice(sf, ef);
    const e = slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
    if (e > maxEnergy) {
      maxEnergy = e;
      dominant = SECTION_LABELS[i % SECTION_LABELS.length]!;
    }
  }
  return dominant;
}

export function useAudioAnalysis(file: File | null): AudioAnalysisState {
  const [state, setState] = useState<AudioAnalysisState>({ status: "idle" });

  useEffect(() => {
    if (!file) {
      setState({ status: "idle" });
      return;
    }

    setState({ status: "analyzing" });
    let cancelled = false;

    const analyze = async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();

        // Decode at a fixed sample rate matching the server-side analysis
        const sampleRate = 22050;
        const offCtx = new OfflineAudioContext(1, 1, sampleRate);
        let decoded: AudioBuffer;
        try {
          decoded = await offCtx.decodeAudioData(arrayBuffer);
        } catch {
          if (!cancelled) setState({ status: "error", message: "Could not decode audio" });
          return;
        }
        if (cancelled) return;

        const channelData = decoded.getChannelData(0);
        const duration = decoded.duration;

        const rms = computeRMS(channelData);
        const bpm = estimateBPM(rms, decoded.sampleRate);

        const rmsArr = Array.from(rms);
        const meanRMS = rmsArr.reduce((a, b) => a + b, 0) / (rms.length || 1);
        const maxRMS = Math.max(...rmsArr, 1e-10);
        const energy = Math.min(1, Math.round((meanRMS / maxRMS) * 2.5 * 100) / 100);

        const mood = determineMood(energy, bpm);
        const dominantSection = findDominantSection(rmsArr, duration);

        if (!cancelled) {
          setState({
            status: "done",
            result: {
              bpm: Math.round(bpm * 10) / 10,
              energy,
              mood,
              dominantSection,
              durationSeconds: Math.round(duration * 100) / 100,
            },
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Analysis failed",
          });
        }
      }
    };

    analyze();
    return () => {
      cancelled = true;
    };
  }, [file]);

  return state;
}
