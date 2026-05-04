import { useEffect, useRef, useState } from "react";

interface AudioWaveformSelectorProps {
  file: File;
  clipDurationSec: number;
  clipStartTime: number;
  onClipStartTimeChange: (time: number) => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SAMPLES = 200;
const SEL_COLOR = "#8b5cf6";
const TRACK_COLOR = "#374151";

export function AudioWaveformSelector({
  file,
  clipDurationSec,
  clipStartTime,
  onClipStartTimeChange,
}: AudioWaveformSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [waveform, setWaveform] = useState<Float32Array | null>(null);

  // ── Phase 1: get duration quickly via HTML5 Audio metadata ────────────────
  useEffect(() => {
    let cancelled = false;
    setTotalDuration(0);
    setWaveform(null);

    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";

    audio.addEventListener("loadedmetadata", () => {
      if (!cancelled && isFinite(audio.duration) && audio.duration > 0) {
        setTotalDuration(audio.duration);
      }
      URL.revokeObjectURL(url);
    });

    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
    });

    audio.src = url;

    return () => {
      cancelled = true;
      audio.src = "";
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // ── Phase 2: decode waveform bars in background ───────────────────────────
  useEffect(() => {
    if (totalDuration === 0) return;
    let cancelled = false;

    const decode = async () => {
      try {
        const buf = await file.arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const audioBuf = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        const ch = audioBuf.getChannelData(0);
        const block = Math.max(1, Math.floor(ch.length / SAMPLES));
        const out = new Float32Array(SAMPLES);
        for (let i = 0; i < SAMPLES; i++) {
          let peak = 0;
          for (let j = 0; j < block; j++) {
            const v = Math.abs(ch[i * block + j] ?? 0);
            if (v > peak) peak = v;
          }
          out[i] = peak;
        }
        if (!cancelled) setWaveform(out);
      } catch {
        // Waveform bars are optional — slider still works without them
      }
    };

    decode();
    return () => { cancelled = true; };
  }, [file, totalDuration]);

  // ── Canvas draw ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const mid = H / 2;

    ctx.clearRect(0, 0, W, H);

    const dur = totalDuration || 1;
    const selStartRatio = Math.min(clipStartTime / dur, 1);
    const selEndRatio = Math.min((clipStartTime + clipDurationSec) / dur, 1);
    const selStartX = selStartRatio * W;
    const selEndX = selEndRatio * W;

    if (waveform) {
      const barW = W / SAMPLES;
      for (let i = 0; i < SAMPLES; i++) {
        const x = i * barW;
        const inSel = x >= selStartX && x < selEndX;
        const h = Math.max(2, (waveform[i] ?? 0.3) * mid * 0.9);
        ctx.fillStyle = inSel ? SEL_COLOR : TRACK_COLOR;
        ctx.fillRect(x, mid - h, Math.max(1, barW - 0.5), h * 2);
      }
    } else {
      // Placeholder gradient bar while waveform loads
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, TRACK_COLOR);
      grad.addColorStop(selStartRatio, TRACK_COLOR);
      grad.addColorStop(selStartRatio, SEL_COLOR);
      grad.addColorStop(selEndRatio, SEL_COLOR);
      grad.addColorStop(selEndRatio, TRACK_COLOR);
      grad.addColorStop(1, TRACK_COLOR);
      ctx.fillStyle = grad;
      ctx.fillRect(0, mid - 4, W, 8);
    }

    // Selection highlight
    ctx.fillStyle = "rgba(139,92,246,0.12)";
    ctx.fillRect(selStartX, 0, selEndX - selStartX, H);

    // Selection border
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2;
    ctx.strokeRect(selStartX + 1, 1, selEndX - selStartX - 2, H - 2);

  }, [waveform, totalDuration, clipStartTime, clipDurationSec]);

  // ── Slider state ──────────────────────────────────────────────────────────
  const maxStart = totalDuration > 0
    ? Math.max(0, totalDuration - clipDurationSec)
    : 0;

  const clampedStart = totalDuration > 0
    ? Math.min(clipStartTime, maxStart)
    : 0;

  const endTime = totalDuration > 0
    ? Math.min(clampedStart + clipDurationSec, totalDuration)
    : clipDurationSec;

  return (
    <div className="space-y-3">
      {/* Waveform canvas */}
      <div className="rounded-xl overflow-hidden border border-border/40 bg-background/60">
        <canvas
          ref={canvasRef}
          width={800}
          height={72}
          className="w-full block"
          style={{ height: 72 }}
        />
      </div>

      {/* Slider — always rendered */}
      <div className="px-0.5">
        <input
          type="range"
          min={0}
          max={maxStart}
          step={0.05}
          value={clampedStart}
          onChange={(e) => onClipStartTimeChange(parseFloat(e.target.value))}
          disabled={maxStart <= 0}
          className="w-full cursor-pointer"
          style={{ accentColor: "#8b5cf6" }}
        />
      </div>

      {/* Time readout */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground/60 font-mono">
          {totalDuration > 0 ? "0:00" : "—"}
        </span>
        <span className="text-primary font-semibold tabular-nums">
          {totalDuration > 0
            ? `${formatTime(clampedStart)} → ${formatTime(endTime)}`
            : `Loading…`}
          <span className="text-muted-foreground font-normal ml-1.5">
            ({clipDurationSec}s clip)
          </span>
        </span>
        <span className="text-muted-foreground/60 font-mono">
          {totalDuration > 0 ? formatTime(totalDuration) : "—"}
        </span>
      </div>

      {totalDuration > 0 && maxStart <= 0 && (
        <p className="text-xs text-amber-500 text-center">
          Your track is {formatTime(totalDuration)} — shorter than the {clipDurationSec}s clip. The full track will be used.
        </p>
      )}
    </div>
  );
}
