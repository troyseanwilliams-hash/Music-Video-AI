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
        <div className="rounded-xl bg-secondary/30 border border-border/40 p-4">
          <p className="text-xs text-muted-foreground text-center">
            Waveform preview unavailable — selection still works.
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
// Use while real duration is unknown — wide enough for most tracks
const FALLBACK_DURATION = 300;

function AudioWaveformSelectorInner({
  file,
  clipDurationSec,
  clipStartTime,
  onClipStartTimeChange,
}: AudioWaveformSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [totalDuration, setTotalDuration] = useState(0);   // 0 = not yet known
  const [waveform, setWaveform] = useState<Float32Array | null>(null);
  const [analyzing, setAnalyzing] = useState(true);

  // ── Duration via HTML5 Audio metadata ────────────────────────────────────
  // This is a "nice to have" — the slider works immediately without it
  useEffect(() => {
    let cancelled = false;
    setTotalDuration(0);
    setWaveform(null);
    setAnalyzing(true);

    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";

    const finish = (dur: number) => {
      if (!cancelled) {
        setTotalDuration(dur);
        setAnalyzing(false);
      }
      URL.revokeObjectURL(url);
    };

    audio.addEventListener("loadedmetadata", () => {
      if (isFinite(audio.duration) && audio.duration > 0) finish(audio.duration);
      else finish(0);
    });
    audio.addEventListener("error", () => {
      if (!cancelled) setAnalyzing(false);
      URL.revokeObjectURL(url);
    });

    // Hard timeout — if metadata never fires, unlock UI after 3 s
    const timer = setTimeout(() => {
      if (!cancelled) setAnalyzing(false);
    }, 3000);

    audio.src = url;
    audio.load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", () => {});
      audio.removeEventListener("error", () => {});
      audio.src = "";
    };
  }, [file]);

  // ── Waveform bars via OfflineAudioContext ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const decode = async () => {
      try {
        const buf = await file.arrayBuffer();
        const offCtx = new OfflineAudioContext(1, 1, 44100);
        const audioBuf = await offCtx.decodeAudioData(buf);
        if (cancelled) return;

        // If Audio metadata didn't fire, use decoded duration
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
      } catch { /* waveform bars are optional */ }
    };
    decode();
    return () => { cancelled = true; };
  }, [file]);

  // ── Derived slider values ─────────────────────────────────────────────────
  // If we don't know duration yet, use FALLBACK so slider is always draggable
  const knownDuration = totalDuration > 0 ? totalDuration : FALLBACK_DURATION;
  const maxStart = Math.max(0, knownDuration - clipDurationSec);
  const clampedStart = Math.min(clipStartTime, maxStart);
  const endTime = Math.min(clampedStart + clipDurationSec, knownDuration);
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

    const dur = totalDuration > 0 ? totalDuration : FALLBACK_DURATION;
    const sx = Math.min(clampedStart / dur, 1) * W;
    const ex = Math.min(endTime / dur, 1) * W;

    // Draw bars or placeholder
    for (let i = 0; i < SAMPLES; i++) {
      const x = (i / SAMPLES) * W;
      const inSel = x >= sx && x < ex;
      let amp: number;
      if (waveform) {
        amp = waveform[i] ?? 0;
      } else if (!analyzing) {
        // Placeholder wavy bars once we're past loading
        amp = 0.2 + 0.18 * Math.sin(i * 0.3) + 0.08 * Math.sin(i * 0.7);
      } else {
        amp = 0.06; // flat loading bar
      }
      const h = Math.max(2, amp * mid * 0.9);
      ctx.fillStyle = inSel ? "#8b5cf6" : "#2d3748";
      ctx.fillRect(x, mid - h, Math.max(1, W / SAMPLES - 0.5), h * 2);
    }

    // Selection tint + border
    ctx.fillStyle = "rgba(139,92,246,0.10)";
    ctx.fillRect(sx, 0, ex - sx, H);
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, 1, Math.max(0, ex - sx - 2), H - 2);
  }, [waveform, totalDuration, clampedStart, endTime, analyzing]);

  // ── Slider: track which thumb moved ──────────────────────────────────────
  const prevRef = useRef<[number, number]>([clampedStart, endTime]);
  useEffect(() => { prevRef.current = [clampedStart, endTime]; }, [clampedStart, endTime]);

  const onSliderChange = (vals: number[]) => {
    const [ns, ne] = vals as [number, number];
    const [ps] = prevRef.current;
    let next: number;
    if (Math.abs(ns - ps) >= 0.04) {
      // left thumb moved
      next = Math.min(ns, maxStart);
    } else {
      // right thumb moved
      next = Math.max(0, Math.min(ne - clipDurationSec, maxStart));
    }
    prevRef.current = [next, next + clipDurationSec];
    onClipStartTimeChange(next);
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
        {analyzing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[10px] text-muted-foreground/50 tracking-widest uppercase">
              Analyzing audio…
            </p>
          </div>
        )}
        {!analyzing && !waveform && (
          <div className="absolute bottom-1 right-2">
            <p className="text-[9px] text-muted-foreground/30">loading waveform…</p>
          </div>
        )}
      </div>

      {/* Two-thumb slider — always enabled so user can drag immediately */}
      <Slider
        min={0}
        max={knownDuration}
        step={0.1}
        value={[clampedStart, endTime]}
        onValueChange={onSliderChange}
        className="py-1"
      />

      {/* Start / Duration / End labels */}
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

      {/* Track length hint */}
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
