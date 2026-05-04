import { useEffect, useRef, useState, Component, type ReactNode } from "react";

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
        <div className="rounded-xl bg-secondary/30 border border-border/40 p-4">
          <p className="text-xs text-muted-foreground text-center">
            Waveform preview unavailable.
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

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SAMPLES = 200;
const FALLBACK_DURATION = 300;

function AudioWaveformSelectorInner({
  file,
  clipDurationSec,
  clipStartTime,
  onClipStartTimeChange,
}: AudioWaveformSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [totalDuration, setTotalDuration] = useState(0);
  const [waveform, setWaveform] = useState<Float32Array | null>(null);
  const [analyzing, setAnalyzing] = useState(true);

  // ── Get duration via Audio element ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setTotalDuration(0);
    setWaveform(null);
    setAnalyzing(true);

    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";

    const onMeta = () => {
      if (!cancelled && isFinite(audio.duration) && audio.duration > 0) {
        setTotalDuration(audio.duration);
        setAnalyzing(false);
      }
      URL.revokeObjectURL(url);
    };
    const onErr = () => {
      if (!cancelled) setAnalyzing(false);
      URL.revokeObjectURL(url);
    };

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("error", onErr);

    const timer = setTimeout(() => {
      if (!cancelled) setAnalyzing(false);
    }, 3000);

    audio.src = url;
    audio.load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("error", onErr);
      audio.src = "";
    };
  }, [file]);

  // ── Waveform via OfflineAudioContext ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const decode = async () => {
      try {
        const buf = await file.arrayBuffer();
        const offCtx = new OfflineAudioContext(1, 1, 44100);
        const audioBuf = await offCtx.decodeAudioData(buf);
        if (cancelled) return;
        if (audioBuf.duration > 0) {
          setTotalDuration(prev => prev > 0 ? prev : audioBuf.duration);
          setAnalyzing(false);
        }
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
      } catch { /* waveform is optional */ }
    };
    decode();
    return () => { cancelled = true; };
  }, [file]);

  // ── Derived values ────────────────────────────────────────────────────────
  const knownDuration = totalDuration > 0 ? totalDuration : FALLBACK_DURATION;
  const maxStart = Math.max(0, knownDuration - clipDurationSec);
  const clampedStart = Math.min(Math.max(0, clipStartTime), maxStart);
  const endTime = clampedStart + clipDurationSec;
  const trackTooShort = totalDuration > 0 && totalDuration <= clipDurationSec;

  // ── Canvas ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const mid = H / 2;
    ctx.clearRect(0, 0, W, H);

    const dur = knownDuration;
    const sx = (clampedStart / dur) * W;
    const ex = (endTime / dur) * W;

    for (let i = 0; i < SAMPLES; i++) {
      const x = (i / SAMPLES) * W;
      const inSel = x >= sx && x < ex;
      let amp: number;
      if (waveform) {
        amp = waveform[i] ?? 0;
      } else if (!analyzing) {
        amp = 0.2 + 0.18 * Math.sin(i * 0.3) + 0.08 * Math.sin(i * 0.7);
      } else {
        amp = 0.06;
      }
      const h = Math.max(2, amp * mid * 0.9);
      ctx.fillStyle = inSel ? "#8b5cf6" : "#2d3748";
      ctx.fillRect(x, mid - h, Math.max(1, W / SAMPLES - 0.5), h * 2);
    }

    ctx.fillStyle = "rgba(139,92,246,0.10)";
    ctx.fillRect(sx, 0, ex - sx, H);
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, 1, Math.max(0, ex - sx - 2), H - 2);
  }, [waveform, knownDuration, clampedStart, endTime, analyzing]);

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
        {analyzing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-[10px] text-muted-foreground/50 tracking-widest uppercase">
              Analyzing audio…
            </p>
          </div>
        )}
      </div>

      {/* ── Native range input — always works in every browser ── */}
      <div className="relative px-1">
        {/* Track */}
        <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-primary/20" />
        {/* Selected range fill */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-primary"
          style={{
            left: `calc(${(clampedStart / knownDuration) * 100}% + 4px)`,
            right: `calc(${((knownDuration - endTime) / knownDuration) * 100}% + 4px)`,
          }}
        />
        {/* Thumb marker for end (visual only) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-background border-2 border-primary shadow pointer-events-none"
          style={{ left: `calc(${(endTime / knownDuration) * 100}% - 8px)` }}
        />
        {/* Native range input for start position */}
        <input
          type="range"
          min={0}
          max={maxStart > 0 ? maxStart : 1}
          step={0.1}
          value={clampedStart}
          onChange={(e) => onClipStartTimeChange(parseFloat(e.target.value))}
          className="waveform-range relative"
          style={{ zIndex: 10 }}
        />
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between">
        <div className="text-center min-w-[56px]">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Start</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: "#a78bfa" }}>
            {fmt(clampedStart)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Duration</p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {clipDurationSec}s
          </p>
        </div>
        <div className="text-center min-w-[56px]">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">End</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: "#a78bfa" }}>
            {fmt(endTime)}
          </p>
        </div>
      </div>

      {/* Total length */}
      <div className="flex justify-between text-[10px] text-muted-foreground/40 font-mono px-0.5">
        <span>0:00</span>
        {totalDuration > 0
          ? <span>{fmt(totalDuration)} total</span>
          : <span className="animate-pulse">detecting length…</span>}
      </div>

      {trackTooShort && (
        <p className="text-xs text-amber-500 text-center">
          Track ({fmt(totalDuration)}) is shorter than {clipDurationSec}s — full track will be used.
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
