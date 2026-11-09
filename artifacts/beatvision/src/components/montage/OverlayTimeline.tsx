import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { Film, Type } from "lucide-react";
import { clamp, type TextCard, type VideoOverlay } from "./overlayTypes";

interface Item { id: string; label: string; startSec: number; durationSec: number }

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** Greedy lane packing so overlapping items never hide each other. */
export function packLanes<T extends { startSec: number; durationSec: number }>(items: T[]): T[][] {
  const lanes: T[][] = [];
  const ends: number[] = [];
  for (const item of [...items].sort((a, b) => a.startSec - b.startSec)) {
    const lane = ends.findIndex((end) => end <= item.startSec + 1e-6);
    if (lane >= 0) { lanes[lane]!.push(item); ends[lane] = item.startSec + item.durationSec; }
    else { lanes.push([item]); ends.push(item.startSec + item.durationSec); }
  }
  return lanes;
}

function Lane({
  items, kind, total, selectedId, onSelect, onMove, laneLabel,
}: {
  items: Item[];
  kind: "overlay" | "text";
  total: number;
  selectedId: string | null;
  onSelect: (item: Item) => void;
  onMove: (id: string, startSec: number) => void;
  laneLabel: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | { id: string; px: number; start: number; dur: number; moved: boolean }>(null);
  const maxStart = (dur: number) => Math.max(0, total - dur);

  const down = (item: Item) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = { id: item.id, px: e.clientX, start: item.startSec, dur: item.durationSec, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!d || !rect || rect.width <= 0) return;
    const dxPx = e.clientX - d.px;
    if (!d.moved && Math.abs(dxPx) < 4) return;
    d.moved = true;
    const next = clamp(d.start + (dxPx / rect.width) * total, 0, maxStart(d.dur));
    onMove(d.id, Math.round(next * 100) / 100);
  };
  const up = (item: Item) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d && !d.moved) onSelect(item);
  };
  const key = (item: Item) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowLeft" ? -1 : 1);
    onMove(item.id, Math.round(clamp(item.startSec + step, 0, maxStart(item.durationSec)) * 100) / 100);
  };

  const Icon = kind === "overlay" ? Film : Type;
  return (
    <div ref={trackRef} className="relative h-8 rounded bg-muted/50" aria-label={laneLabel} role="group">
      {items.map((item) => {
        const left = (item.startSec / total) * 100;
        const width = (item.durationSec / total) * 100;
        const selected = item.id === selectedId;
        const tip = `${item.label} · ${fmt(item.startSec)}–${fmt(item.startSec + item.durationSec)}`;
        return (
          <button
            key={item.id}
            type="button"
            title={`${tip} (drag or use arrow keys to move)`}
            aria-label={`${kind === "overlay" ? "Overlay" : "Text card"}: ${tip}`}
            aria-pressed={selected}
            onPointerDown={down(item)}
            onPointerMove={move}
            onPointerUp={up(item)}
            onPointerCancel={() => { drag.current = null; }}
            onClick={(e) => { if (e.detail === 0) onSelect(item); }}
            onKeyDown={key(item)}
            className={`absolute inset-y-0.5 flex min-w-[14px] touch-none items-center gap-1 overflow-hidden rounded border px-1 text-[10px] font-medium ${
              selected ? "z-10 border-primary bg-primary text-primary-foreground" : kind === "overlay" ? "border-primary/40 bg-primary/20 text-foreground hover:bg-primary/30" : "border-accent/40 bg-accent/15 text-foreground hover:bg-accent/25"
            }`}
            style={{ left: `min(${left}%, calc(100% - 14px))`, width: `${width}%`, cursor: "grab", minHeight: 0 }}
            data-testid={`timeline-${kind}-${item.id}`}
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function OverlayTimeline({
  overlays, textCards, totalDuration, playheadSec, selectedId, onSelect, onSeek, onMoveOverlay, onMoveText,
}: {
  overlays: VideoOverlay[];
  textCards: TextCard[];
  totalDuration: number;
  playheadSec: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeek: (sec: number) => void;
  onMoveOverlay: (id: string, startSec: number) => void;
  onMoveText: (id: string, startSec: number) => void;
}) {
  if ((overlays.length === 0 && textCards.length === 0) || totalDuration <= 0) return null;
  const total = totalDuration;
  const overlayLanes = packLanes(overlays.map((o) => ({ id: o.id, label: o.name, startSec: o.startSec, durationSec: o.durationSec })));
  const textLanes = packLanes(textCards.map((t) => ({ id: t.id, label: t.text.split("\n")[0] || "Text", startSec: t.startSec, durationSec: t.durationSec })));
  const select = (item: Item) => { onSelect(item.id); onSeek(item.startSec); };
  const playheadPct = clamp(playheadSec / total, 0, 1) * 100;

  return (
    <div className="mb-3" data-testid="overlay-timeline">
      <div className="mb-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>0:00.0</span>
        <span>Overlay track · playhead {fmt(playheadSec)}</span>
        <span>{fmt(total)}</span>
      </div>
      <div className="flex gap-2">
        <div className="flex w-12 shrink-0 flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {overlayLanes.map((_, i) => <div key={`o${i}`} className="flex h-8 items-center">Clip {i + 1}</div>)}
          {textLanes.map((_, i) => <div key={`t${i}`} className="flex h-8 items-center">Text {i + 1}</div>)}
        </div>
        <div className="relative min-w-0 flex-1 space-y-1">
          {overlayLanes.map((lane, i) => (
            <Lane key={`o${i}`} items={lane} kind="overlay" total={total} selectedId={selectedId} onSelect={select} onMove={onMoveOverlay} laneLabel={`Overlay lane ${i + 1}`} />
          ))}
          {textLanes.map((lane, i) => (
            <Lane key={`t${i}`} items={lane} kind="text" total={total} selectedId={selectedId} onSelect={select} onMove={onMoveText} laneLabel={`Text card lane ${i + 1}`} />
          ))}
          <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-destructive" style={{ left: `${playheadPct}%` }} aria-hidden="true" data-testid="overlay-timeline-playhead" />
        </div>
      </div>
    </div>
  );
}
