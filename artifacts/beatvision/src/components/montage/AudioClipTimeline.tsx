import { Music } from "lucide-react";
import { clamp } from "./overlayTypes";
import { packLanes } from "./OverlayTimeline";
import type { AudioClip } from "./audioClipTypes";

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** Read-only lanes showing where each timed music clip sounds. Click to select and seek. */
export function AudioClipTimeline({
  clips, totalDuration, playheadSec, selectedId, onSelect, onSeek,
}: {
  clips: AudioClip[];
  totalDuration: number;
  playheadSec: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeek: (sec: number) => void;
}) {
  if (clips.length === 0 || totalDuration <= 0) return null;
  const lanes = packLanes(clips);
  const playheadPct = clamp(playheadSec / totalDuration, 0, 1) * 100;
  return (
    <div className="mb-3" data-testid="audio-clip-timeline">
      <div className="mb-1 text-[10px] text-muted-foreground">Timed music clips (separate from the full-video soundtrack)</div>
      <div className="flex gap-2">
        <div className="flex w-12 shrink-0 flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {lanes.map((_, i) => <div key={i} className="flex h-7 items-center">Music {i + 1}</div>)}
        </div>
        <div className="relative min-w-0 flex-1 space-y-1">
          {lanes.map((lane, i) => (
            <div key={i} className="relative h-7 rounded bg-muted/50" role="group" aria-label={`Music clip lane ${i + 1}`}>
              {lane.map((c) => {
                const selected = c.id === selectedId;
                const tip = `${c.name} · ${fmt(c.startSec)}–${fmt(c.startSec + c.durationSec)} · ${Math.round(c.volume * 100)}%`;
                return (
                  <button
                    key={c.id}
                    type="button"
                    title={tip}
                    aria-label={`Music clip: ${tip}`}
                    aria-pressed={selected}
                    onClick={() => { onSelect(c.id); onSeek(c.startSec); }}
                    className={`absolute inset-y-0.5 flex min-w-[14px] items-center gap-1 overflow-hidden rounded border px-1 text-[10px] font-medium ${
                      selected ? "z-10 border-primary bg-primary text-primary-foreground" : "border-emerald-500/40 bg-emerald-500/15 text-foreground hover:bg-emerald-500/25"
                    }`}
                    style={{ left: `min(${(c.startSec / totalDuration) * 100}%, calc(100% - 14px))`, width: `${(c.durationSec / totalDuration) * 100}%` }}
                    data-testid={`timeline-audio-${c.id}`}
                  >
                    <Music className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-destructive" style={{ left: `${playheadPct}%` }} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
