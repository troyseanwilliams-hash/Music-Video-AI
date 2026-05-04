import { useEffect, useRef, useState, Component, type ReactNode } from "react";

// ── Error boundary prevents waveform crashes from blanking the page ──────────
class WaveformErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: false };
  }
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-20 rounded-xl bg-secondary/30 border border-border/40 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">
            Waveform preview unavailable — clip selection still works below.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

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
const TRACK_COLOR = "#2d3748";

function AudioWaveformSelectorInner({
  file,
  clipDurationSec,
  clipStartTime,
  onClipStartTimeChange,
}: AudioWaveformSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [waveform, setWaveform] = useState<Float32Array | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  // ── Phase 1: get duration via HTML5 Audio metadata (fast, no decode) ──────
  useEffect(() => {
    let cancelled = false;
    setTotalDuration(0);
    setWaveform(null);
    setPhase("loading");

    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";

    const onMeta = () => {
      if (!cancelled && isFinite(audio.duration) && audio.duration > 0) {
        setTotalDuration(audio.duration);
        setPhase("ready");
      } else if (!cancelled) {
        setPhase("error");
      }
      URL.revokeObjectURL(url);
    };

    const onError = () => {
      if (!cancelled) setPhase("error");
      URL.revokeObjectURL(url);
    };

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("error", onError);
    audio.src = url;
    audio.load();

    return () => {
      cancelled = true;
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("error", onError);
      audio.src = "";
    };
  }, [file]);

  // ── Phase 2: decode waveform bars in background ───────────────────────────
  useEffect(() => {
    if (totalDuration === 0) return;
    let cancelled = false;

    const decode = async () => {
      try {
        const buf = await file.arrayBuffer();
        const offCtx = new OfflineAudioContext(1, 1, 44100);
        const audioBuf = await offCtx.decodeAudioData(buf);
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
        // Bars are optional — slider still works
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

    // While loading — show a pulsing placeholder bar, no selection yet
    if (phase === "loading" || totalDuration === 0) {
      ctx.fillStyle = TRACK_COLOR;
      ctx.fillRect(0, mid - 3, W, 6);
      ctx.fillStyle = "#4b5563";
      ctx.fillRect(0, mid - 1, W * 0.4, 2);
      return;
    }

    const selStartRatio = Math.min(clipStartTime / totalDuration, 1);
    const selEndRatio = Math.min((clipStartTime + clipDurationSec) / totalDuration, 1);
    const selStartX = selStartRatio * W;
    const selEndX = selEndRatio * W;

    if (waveform) {
      // Draw actual waveform bars
      const barW = W / SAMPLES;
      for (let i = 0; i < SAMPLES; i++) {
        const x = i * barW;
        const inSel = x >= selStartX && x < selEndX;
        const h = Math.max(2, (waveform[i] ?? 0.3) * mid * 0.9);
        ctx.fillStyle = inSel ? SEL_COLOR : TRACK_COLOR;
        ctx.fillRect(x, mid - h, Math.max(1, barW - 0.5), h * 2);
      }
    } else {
      // Placeholder bars with correct selection region
      for (let i = 0; i < SAMPLES; i++) {
        const x = (i / SAMPLES) * W;
        const inSel = x >= selStartX && x < selEndX;
        const fakeH = mid * (0.2 + 0.2 * Math.sin(i * 0.3) + 0.1 * Math.sin(i * 0.7));
        ctx.fillStyle = inSel ? SEL_COLOR : TRACK_COLOR;
        ctx.fillRect(x, mid - fakeH, Math.max(1, (W / SAMPLES) - 0.5), fakeH * 2);
      }
    }

    // Selection tint + border
    ctx.fillStyle = "rgba(139,92,246,0.10)";
    ctx.fillRect(selStartX, 0, selEndX - selStartX, H);
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2;
    ctx.strokeRect(selStartX + 1, 1, Math.max(0, selEndX - selStartX - 2), H - 2);

  }, [waveform, totalDuration, clipStartTime, clipDurationSec, phase]);

  // ── Slider ────────────────────────────────────────────────────────────────
  const maxStart = totalDuration > 0 ? Math.max(0, totalDuration - clipDurationSec) : 0;
  const clampedStart = totalDuration > 0 ? Math.min(clipStartTime, maxStart) : 0;
  const endTime = totalDuration > 0 ? Math.min(clampedStart + clipDurationSec, totalDuration) : clipDurationSec;

  return (
    <div className="space-y-2">
      {/* Canvas — always visible, immediately shows loading state then selection */}
      <div className="relative rounded-xl overflow-hidden border border-border/40 bg-[#111827]">
        <canvas
          ref={canvasRef}
          width={800}
          height={72}
          className="w-full block"
          style={{ height: 72 }}
        />
        {phase === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[10px] text-muted-foreground/50 tracking-wide uppercase">
              Analyzing audio…
            </p>
          </div>
        )}
        {phase === "ready" && !waveform && (
          <div className="absolute bottom-1 right-2">
            <p className="text-[9px] text-muted-foreground/30">loading waveform…</p>
          </div>
        )}
      </div>

      {/* Slider */}
      <input
        type="range"
        min={0}
        max={maxStart}
        step={0.05}
        value={clampedStart}
        onChange={(e) => onClipStartTimeChange(parseFloat(e.target.value))}
        disabled={phase !== "ready" || maxStart <= 0}
        className="w-full cursor-pointer"
        style={{ accentColor: "#8b5cf6" }}
      />

      {/* Time labels */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground/50 font-mono">
          {totalDuration > 0 ? "0:00" : "—"}
        </span>
        <span className="font-semibold tabular-nums" style={{ color: "#a78bfa" }}>
          {phase === "loading"
            ? "Analyzing…"
            : `${formatTime(clampedStart)} → ${formatTime(endTime)}`}
          <span className="text-muted-foreground font-normal ml-1.5">
            ({clipDurationSec}s clip)
          </span>
        </span>
        <span className="text-muted-foreground/50 font-mono">
          {totalDuration > 0 ? formatTime(totalDuration) : "—"}
        </span>
      </div>

      {phase === "ready" && maxStart <= 0 && (
        <p className="text-xs text-amber-500 text-center">
          Track is {formatTime(totalDuration)} — shorter than {clipDurationSec}s. The full track will be used.
        </p>
      )}
    </div>
  );
}

export function AudioWaveformSelector(props: AudioWaveformSelectorProps) {
  return (
    <WaveformErrorBoundary>
      <AudioWaveformSelectorInner {...props} />
    </WaveformErrorBoundary>
  );
}
