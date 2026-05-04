import { useEffect, useRef, useState, Component, type ReactNode } from "react";
import { Slider } from "@/components/ui/slider";

// ── Error boundary ────────────────────────────────────────────────────────────
class WaveformErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: false };
  }
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) {
      return (
        <div className="h-20 rounded-xl bg-secondary/30 border border-border/40 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">Waveform preview unavailable.</p>
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
  const [totalDuration, setTotalDuration] = useState(0);
  const [waveform, setWaveform] = useState<Float32Array | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  // ── Phase 1: metadata via HTML5 Audio ────────────────────────────────────
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

  // ── Phase 2: waveform bars in background ─────────────────────────────────
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
      } catch { /* bars are optional */ }
    };
    decode();
    return () => { cancelled = true; };
  }, [file, totalDuration]);

  // ── Derived values ────────────────────────────────────────────────────────
  const maxStart = totalDuration > 0 ? Math.max(0, totalDuration - clipDurationSec) : 0;
  const clampedStart = totalDuration > 0 ? Math.min(clipStartTime, maxStart) : 0;
  const endTime = totalDuration > 0 ? Math.min(clampedStart + clipDurationSec, totalDuration) : clipDurationSec;
  const trackTooShort = phase === "ready" && maxStart <= 0;

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

    if (phase === "loading" || totalDuration === 0) {
      ctx.fillStyle = TRACK_COLOR;
      ctx.fillRect(0, mid - 3, W, 6);
      return;
    }

    const selStartRatio = Math.min(clampedStart / totalDuration, 1);
    const selEndRatio = Math.min(endTime / totalDuration, 1);
    const selStartX = selStartRatio * W;
    const selEndX = selEndRatio * W;

    const drawBars = (data: Float32Array | null) => {
      for (let i = 0; i < SAMPLES; i++) {
        const x = (i / SAMPLES) * W;
        const inSel = x >= selStartX && x < selEndX;
        const amp = data ? (data[i] ?? 0) : (0.2 + 0.2 * Math.sin(i * 0.3) + 0.1 * Math.sin(i * 0.7));
        const h = Math.max(2, amp * mid * 0.9);
        ctx.fillStyle = inSel ? SEL_COLOR : TRACK_COLOR;
        ctx.fillRect(x, mid - h, Math.max(1, W / SAMPLES - 0.5), h * 2);
      }
    };
    drawBars(waveform);

    // Selection tint
    ctx.fillStyle = "rgba(139,92,246,0.10)";
    ctx.fillRect(selStartX, 0, selEndX - selStartX, H);

    // Selection border
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2;
    ctx.strokeRect(selStartX + 1, 1, Math.max(0, selEndX - selStartX - 2), H - 2);

  }, [waveform, totalDuration, clampedStart, endTime, phase]);

  // ── Two-thumb slider handler ──────────────────────────────────────────────
  const prevValuesRef = useRef([clampedStart, endTime]);

  const handleSliderChange = (values: number[]) => {
    const [newStart, newEnd] = values;
    const [prevStart, prevEnd] = prevValuesRef.current;

    let nextStart = clampedStart;

    if (newStart !== prevStart) {
      // Left thumb moved
      nextStart = Math.min(newStart, maxStart);
    } else if (newEnd !== prevEnd) {
      // Right thumb moved — derive start from new end
      nextStart = Math.max(0, Math.min(newEnd - clipDurationSec, maxStart));
    }

    prevValuesRef.current = [nextStart, nextStart + clipDurationSec];
    onClipStartTimeChange(nextStart);
  };

  return (
    <div className="space-y-3">
      {/* Waveform canvas */}
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
            <p className="text-[10px] text-muted-foreground/50 tracking-widest uppercase">
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

      {/* Two-thumb range slider */}
      <Slider
        min={0}
        max={totalDuration > 0 ? totalDuration : clipDurationSec}
        step={0.05}
        value={[clampedStart, endTime]}
        onValueChange={handleSliderChange}
        disabled={phase !== "ready" || trackTooShort}
        minStepsBetweenThumbs={Math.round(clipDurationSec / 0.05)}
        className="py-1"
      />

      {/* Start / End time labels */}
      <div className="flex items-center justify-between">
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Start</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: "#a78bfa" }}>
            {phase === "loading" ? "—" : formatTime(clampedStart)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Duration</p>
          <p className="text-sm font-semibold tabular-nums text-muted-foreground">
            {clipDurationSec}s
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">End</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: "#a78bfa" }}>
            {phase === "loading" ? "—" : formatTime(endTime)}
          </p>
        </div>
      </div>

      {/* Track length */}
      {totalDuration > 0 && (
        <div className="flex justify-between text-[10px] text-muted-foreground/40 font-mono px-0.5">
          <span>0:00</span>
          <span>{formatTime(totalDuration)} total</span>
        </div>
      )}

      {trackTooShort && (
        <p className="text-xs text-amber-500 text-center">
          Track ({formatTime(totalDuration)}) is shorter than {clipDurationSec}s — the full track will be used.
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
