import { useEffect, useRef, useState, useCallback, Component, type ReactNode } from "react";

// ── Error boundary ────────────────────────────────────────────────────────────
class WaveformErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: false };
  }
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl bg-secondary/30 border border-border/40 p-4">
          <p className="text-xs text-muted-foreground text-center">Waveform preview unavailable.</p>
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

// ── Play icon ─────────────────────────────────────────────────────────────────
function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <polygon points="3,1 13,7 3,13" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="2" y="1" width="4" height="12" rx="1" />
      <rect x="8" y="1" width="4" height="12" rx="1" />
    </svg>
  );
}

function AudioWaveformSelectorInner({
  file,
  clipDurationSec,
  clipStartTime,
  onClipStartTimeChange,
}: AudioWaveformSelectorProps) {
  const barsCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);

  const [totalDuration, setTotalDuration] = useState(0);
  const [waveform, setWaveform] = useState<Float32Array | null>(null);
  const [analyzing, setAnalyzing] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  // Stable refs for values needed inside RAF / audio callbacks
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string>("");
  const rafRef = useRef<number>(0);
  const clampedStartRef = useRef(0);
  const endTimeRef = useRef(0);
  const knownDurationRef = useRef(FALLBACK_DURATION);

  // ── Derived values ──────────────────────────────────────────────────────────
  const safeDuration = (isFinite(clipDurationSec) && clipDurationSec > 0) ? clipDurationSec : 10;
  const knownDuration = totalDuration > 0 ? totalDuration : FALLBACK_DURATION;
  const maxStart = Math.max(0, knownDuration - safeDuration);
  const clampedStart = Math.min(Math.max(0, clipStartTime), maxStart);
  const endTime = clampedStart + safeDuration;
  const trackTooShort = totalDuration > 0 && totalDuration <= safeDuration;

  // Keep refs in sync so RAF callbacks always see current values
  clampedStartRef.current = clampedStart;
  endTimeRef.current = endTime;
  knownDurationRef.current = knownDuration;

  // ── Create audio element once per file ─────────────────────────────────────
  useEffect(() => {
    // Tear down previous
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
    setTotalDuration(0);
    setWaveform(null);
    setAnalyzing(true);

    const url = URL.createObjectURL(file);
    audioUrlRef.current = url;

    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onMeta = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setTotalDuration(audio.duration);
        setAnalyzing(false);
      }
    };
    const onErr = () => setAnalyzing(false);
    const onEnded = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
    };

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("error", onErr);
    audio.addEventListener("ended", onEnded);
    audio.src = url;
    audio.load();

    const timer = setTimeout(() => setAnalyzing(false), 3000);

    return () => {
      clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("error", onErr);
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audio.src = "";
      URL.revokeObjectURL(url);
      audioUrlRef.current = "";
      audioRef.current = null;
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    };
  }, [file]);

  // ── Waveform decode ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const decode = async () => {
      try {
        const buf = await file.arrayBuffer();
        const offCtx = new OfflineAudioContext(1, 1, 44100);
        const audioBuf = await offCtx.decodeAudioData(buf);
        if (cancelled) return;
        if (audioBuf.duration > 0)
          setTotalDuration(prev => prev > 0 ? prev : audioBuf.duration);
        setAnalyzing(false);
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
      } catch { /* waveform bars optional */ }
    };
    decode();
    return () => { cancelled = true; };
  }, [file]);

  // ── Draw bars + selection (bottom canvas) ──────────────────────────────────
  useEffect(() => {
    const canvas = barsCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const mid = H / 2;
    ctx.clearRect(0, 0, W, H);

    const sx = (clampedStart / knownDuration) * W;
    const ex = (endTime / knownDuration) * W;

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

  // ── Draw cursor (overlay canvas) ────────────────────────────────────────────
  const drawCursor = useCallback((posSeconds: number) => {
    const canvas = cursorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (posSeconds <= 0) return;
    const x = (posSeconds / knownDurationRef.current) * W;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, []);

  // ── RAF loop ────────────────────────────────────────────────────────────────
  const startRaf = useCallback(() => {
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const pos = audio.currentTime;
      drawCursor(pos);
      if (pos >= endTimeRef.current) {
        audio.pause();
        setIsPlaying(false);
        drawCursor(endTimeRef.current);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [drawCursor]);

  // ── Play / Pause ─────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    } else {
      // Seek to clip start then play
      audio.currentTime = clampedStartRef.current;
      audio.play().then(() => {
        setIsPlaying(true);
        startRaf();
      }).catch(() => {});
    }
  }, [isPlaying, startRaf]);

  // Stop playback when clip start changes while playing
  useEffect(() => {
    if (isPlaying) {
      const audio = audioRef.current;
      if (audio) { audio.pause(); }
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
      // Clear cursor
      const canvas = cursorCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedStart]);

  return (
    <div className="space-y-3">
      {/* Waveform canvas stack */}
      <div className="relative rounded-xl overflow-hidden border border-border/40 bg-[#111827]" style={{ height: 72 }}>
        {/* Bars + selection */}
        <canvas
          ref={barsCanvasRef}
          width={800}
          height={72}
          className="absolute inset-0 w-full h-full block"
        />
        {/* Cursor overlay */}
        <canvas
          ref={cursorCanvasRef}
          width={800}
          height={72}
          className="absolute inset-0 w-full h-full block pointer-events-none"
        />
        {analyzing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-[10px] text-muted-foreground/50 tracking-widest uppercase">
              Analyzing audio…
            </p>
          </div>
        )}
      </div>

      {/* Play button + slider row */}
      <div className="flex items-center gap-3">
        {/* Play / Pause */}
        <button
          onClick={togglePlay}
          title={isPlaying ? "Pause" : "Play selected clip"}
          className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full border border-primary/60 bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        {/* Slider track */}
        <div className="relative flex-1 px-1">
          <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-primary/20" />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-primary"
            style={{
              left: `calc(${(clampedStart / knownDuration) * 100}% + 4px)`,
              right: `calc(${((knownDuration - endTime) / knownDuration) * 100}% + 4px)`,
            }}
          />
          {/* End thumb (visual) */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-background border-2 border-primary shadow pointer-events-none"
            style={{ left: `calc(${(endTime / knownDuration) * 100}% - 8px)` }}
          />
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
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between">
        <div className="text-center min-w-[56px]">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Start</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: "#a78bfa" }}>{fmt(clampedStart)}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Duration</p>
          <p className="text-sm font-semibold tabular-nums text-foreground">{safeDuration}s</p>
        </div>
        <div className="text-center min-w-[56px]">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">End</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: "#a78bfa" }}>{fmt(endTime)}</p>
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
          Track ({fmt(totalDuration)}) is shorter than {safeDuration}s — full track will be used.
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
