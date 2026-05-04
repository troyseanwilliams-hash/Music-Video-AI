import { useEffect, useRef, useState, useCallback } from "react";

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

const WAVEFORM_SAMPLES = 600;
const BAR_GAP = 0.5;
const TRACK_COLOR = "#374151";
const SELECTION_COLOR = "#8b5cf6";
const SELECTION_BG = "rgba(139,92,246,0.15)";
const HANDLE_COLOR = "#a78bfa";

export function AudioWaveformSelector({
  file,
  clipDurationSec,
  clipStartTime,
  onClipStartTimeChange,
}: AudioWaveformSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const [totalDuration, setTotalDuration] = useState(0);
  const [isDecoding, setIsDecoding] = useState(true);

  // ── Audio decode ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsDecoding(true);
    setWaveformData(null);
    setTotalDuration(0);

    const decode = async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        // OfflineAudioContext avoids autoplay-policy suspension issues
        const probe = new OfflineAudioContext(1, 1, 44100);
        const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
          probe.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
        });
        if (cancelled) return;

        const dur = audioBuffer.duration;
        setTotalDuration(dur);

        const channelData = audioBuffer.getChannelData(0);
        const blockSize = Math.max(1, Math.floor(channelData.length / WAVEFORM_SAMPLES));
        const waveform = new Float32Array(WAVEFORM_SAMPLES);
        for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
          let peak = 0;
          for (let j = 0; j < blockSize; j++) {
            const v = Math.abs(channelData[i * blockSize + j] ?? 0);
            if (v > peak) peak = v;
          }
          waveform[i] = peak;
        }
        if (!cancelled) {
          setWaveformData(waveform);
          setIsDecoding(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Waveform decode error:", err);
          setIsDecoding(false);
        }
      }
    };

    decode();
    return () => { cancelled = true; };
  }, [file]);

  // ── Canvas draw ───────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData || totalDuration === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const mid = H / 2;
    const barWidth = W / WAVEFORM_SAMPLES;

    ctx.clearRect(0, 0, W, H);

    const selStartRatio = Math.min(clipStartTime / totalDuration, 1);
    const selEndRatio = Math.min((clipStartTime + clipDurationSec) / totalDuration, 1);
    const selStartX = selStartRatio * W;
    const selEndX = selEndRatio * W;

    // Draw bars
    for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
      const x = i * barWidth;
      const inSel = x >= selStartX && x < selEndX;
      const h = Math.max(2, (waveformData[i] ?? 0) * mid * 0.9);
      ctx.fillStyle = inSel ? SELECTION_COLOR : TRACK_COLOR;
      ctx.fillRect(x, mid - h, Math.max(1, barWidth - BAR_GAP), h * 2);
    }

    // Selection background tint
    ctx.fillStyle = SELECTION_BG;
    ctx.fillRect(selStartX, 0, selEndX - selStartX, H);

    // Selection border
    ctx.strokeStyle = HANDLE_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(selStartX + 1, 1, selEndX - selStartX - 2, H - 2);

    // Drag handles
    const handleW = 5;
    const handleH = 32;
    ctx.fillStyle = HANDLE_COLOR;
    ctx.beginPath();
    ctx.roundRect(selStartX - handleW / 2, mid - handleH / 2, handleW, handleH, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(selEndX - handleW / 2, mid - handleH / 2, handleW, handleH, 2);
    ctx.fill();
  }, [waveformData, totalDuration, clipStartTime, clipDurationSec]);

  useEffect(() => { draw(); }, [draw]);

  // ── Slider range ──────────────────────────────────────────────────────────
  const maxStart = Math.max(0, totalDuration - clipDurationSec);
  const clampedStart = Math.min(clipStartTime, maxStart);
  const endTime = Math.min(clampedStart + clipDurationSec, totalDuration);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onClipStartTimeChange(parseFloat(e.target.value));
  };

  return (
    <div className="space-y-2">
      {isDecoding ? (
        <div className="h-20 rounded-xl bg-secondary/30 border border-border/40 flex items-center justify-center">
          <p className="text-xs text-muted-foreground animate-pulse">Analyzing audio waveform…</p>
        </div>
      ) : waveformData ? (
        <div className="space-y-1">
          {/* Waveform canvas — visual only */}
          <div className="relative rounded-xl overflow-hidden border border-border/40 bg-background/60">
            <canvas
              ref={canvasRef}
              width={1200}
              height={80}
              className="w-full h-20 block"
            />
          </div>

          {/* Native range slider — this is what actually controls the position */}
          <input
            type="range"
            min={0}
            max={maxStart > 0 ? maxStart : 0}
            step={0.1}
            value={clampedStart}
            onChange={handleSliderChange}
            disabled={maxStart === 0}
            className="w-full h-2 appearance-none rounded-full cursor-pointer accent-violet-500"
            style={{ accentColor: "#8b5cf6" }}
          />

          {/* Time labels */}
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10px] text-muted-foreground/60 font-mono">0:00</span>
            <span className="text-xs text-primary font-medium">
              {formatTime(clampedStart)} → {formatTime(endTime)}
              <span className="text-muted-foreground font-normal ml-1">
                ({clipDurationSec}s clip)
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground/60 font-mono">{formatTime(totalDuration)}</span>
          </div>
        </div>
      ) : (
        <div className="h-20 rounded-xl bg-secondary/30 border border-border/40 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">Could not decode audio for preview</p>
        </div>
      )}
    </div>
  );
}
