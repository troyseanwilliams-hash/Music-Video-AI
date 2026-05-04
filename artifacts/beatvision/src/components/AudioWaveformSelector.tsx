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
const SELECTION_BG = "rgba(139,92,246,0.12)";
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

  // Drag state stored in refs so event handlers always see current values
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartTime = useRef(0);
  const totalDurationRef = useRef(0);
  const clipDurationSecRef = useRef(clipDurationSec);
  const clipStartTimeRef = useRef(clipStartTime);

  // Keep refs in sync with props/state
  useEffect(() => { totalDurationRef.current = totalDuration; }, [totalDuration]);
  useEffect(() => { clipDurationSecRef.current = clipDurationSec; }, [clipDurationSec]);
  useEffect(() => { clipStartTimeRef.current = clipStartTime; }, [clipStartTime]);

  // ── Audio decode ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsDecoding(true);
    setWaveformData(null);
    setTotalDuration(0);

    const decode = async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
          ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
        });
        await ctx.close();
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

    for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
      const x = i * barWidth;
      const inSel = x >= selStartX && x < selEndX;
      const h = Math.max(2, (waveformData[i] ?? 0) * mid * 0.9);
      ctx.fillStyle = inSel ? SELECTION_COLOR : TRACK_COLOR;
      ctx.fillRect(x, mid - h, Math.max(1, barWidth - BAR_GAP), h * 2);
    }

    ctx.fillStyle = SELECTION_BG;
    ctx.fillRect(selStartX, 0, selEndX - selStartX, H);

    const borderRadius = 2;
    ctx.strokeStyle = HANDLE_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(selStartX + borderRadius, 0);
    ctx.lineTo(selEndX - borderRadius, 0);
    ctx.lineTo(selEndX, borderRadius);
    ctx.lineTo(selEndX, H - borderRadius);
    ctx.lineTo(selEndX - borderRadius, H);
    ctx.lineTo(selStartX + borderRadius, H);
    ctx.lineTo(selStartX, H - borderRadius);
    ctx.lineTo(selStartX, borderRadius);
    ctx.closePath();
    ctx.stroke();

    const handleW = 4;
    const handleH = 28;
    ctx.fillStyle = HANDLE_COLOR;
    ctx.beginPath();
    ctx.roundRect(selStartX - handleW / 2, mid - handleH / 2, handleW, handleH, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(selEndX - handleW / 2, mid - handleH / 2, handleW, handleH, 2);
    ctx.fill();
  }, [waveformData, totalDuration, clipStartTime, clipDurationSec]);

  useEffect(() => { draw(); }, [draw]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const clampStart = (start: number) => {
    const dur = totalDurationRef.current;
    const clipDur = clipDurationSecRef.current;
    return Math.max(0, Math.min(start, Math.max(0, dur - clipDur)));
  };

  const xToTime = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || totalDurationRef.current === 0) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * totalDurationRef.current;
  };

  // ── Pointer events (capture keeps tracking even outside the element) ──────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (totalDurationRef.current === 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartTime.current = clipStartTimeRef.current;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging.current || totalDurationRef.current === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - dragStartX.current;
    const timeDelta = (dx / rect.width) * totalDurationRef.current;
    onClipStartTimeChange(clampStart(dragStartTime.current + timeDelta));
  }, [onClipStartTimeChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    const wasDrag = Math.abs(e.clientX - dragStartX.current) > 4;
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (!wasDrag) {
      // Treat as a click: center selection under cursor
      const t = xToTime(e.clientX);
      onClipStartTimeChange(clampStart(t - clipDurationSecRef.current / 2));
    }
  }, [onClipStartTimeChange]);

  const endTime = Math.min(clipStartTime + clipDurationSec, totalDuration);

  return (
    <div className="space-y-2">
      {isDecoding ? (
        <div className="h-20 rounded-xl bg-secondary/30 border border-border/40 flex items-center justify-center">
          <p className="text-xs text-muted-foreground animate-pulse">Analyzing audio waveform…</p>
        </div>
      ) : waveformData ? (
        <div className="relative select-none">
          <canvas
            ref={canvasRef}
            width={1200}
            height={80}
            className="w-full h-20 rounded-xl border border-border/40 bg-background/60 cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <div className="flex items-center justify-between mt-1.5 px-0.5">
            <span className="text-[10px] text-muted-foreground/60 font-mono">0:00</span>
            <span className="text-xs text-primary font-medium">
              {formatTime(clipStartTime)} → {formatTime(endTime)}
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
