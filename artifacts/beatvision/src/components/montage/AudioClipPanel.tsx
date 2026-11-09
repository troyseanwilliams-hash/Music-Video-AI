import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { SoundtrackPickerDialog } from "@/components/SoundtrackPickerDialog";
import { Clock, Copy, Library, Loader2, Music, Trash2, Upload } from "lucide-react";
import type { LayerIssue } from "./overlayTypes";
import {
  audioClipId, DEFAULT_AUDIO_CLIP_VOLUME, fitAudioDuration, MAX_AUDIO_CLIPS, MAX_SIMULTANEOUS_AUDIO_CLIPS, MIN_AUDIO_CLIP_SEC,
  probeAudioDuration, type AudioClip,
} from "./audioClipTypes";

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** Number field that keeps a text draft so partial input like "1." is not lost. */
function SecondsField({
  label, value, onCommit, testId, min = 0, step = 0.1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  testId: string;
  min?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <label className="block text-[11px] text-muted-foreground">
      {label}
      <Input
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onCommit(Math.round(n * 100) / 100);
        }}
        onBlur={() => setDraft(String(value))}
        className="mt-1 h-8 text-xs tabular-nums"
        data-testid={testId}
      />
    </label>
  );
}

interface PendingUpload { key: string; name: string }

export function AudioClipPanel({
  clips, setClips, selectedId, setSelectedId, playheadSec, totalDuration, sourceDurations, onSourceDuration,
  uploadFile, issues, epoch, onPendingChange, soundtrack, sourceErrors = {},
}: {
  /** objectPaths whose audio could not be loaded or played in the preview. */
  sourceErrors?: Record<string, boolean>;
  clips: AudioClip[];
  setClips: Dispatch<SetStateAction<AudioClip[]>>;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  playheadSec: number;
  totalDuration: number;
  sourceDurations: Record<string, number>;
  onSourceDuration: (objectPath: string, sec: number) => void;
  uploadFile: (file: File) => Promise<string>;
  issues: LayerIssue[];
  /** Changes when a different project is loaded; in-flight uploads from before are discarded. */
  epoch: number;
  onPendingChange?: (pending: boolean) => void;
  /** The continuous full-video soundtrack, offered as a source to reuse. */
  soundtrack?: { name: string; objectPath: string } | null;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const genRef = useRef(0);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const pendingCb = useRef(onPendingChange);
  pendingCb.current = onPendingChange;

  useEffect(() => {
    genRef.current += 1;
    setPending([]);
  }, [epoch]);
  useEffect(() => () => { genRef.current += 1; pendingCb.current?.(false); }, []);
  useEffect(() => { pendingCb.current?.(pending.length > 0); }, [pending.length]);

  const atLimit = clips.length + pending.length >= MAX_AUDIO_CLIPS;
  const total = Math.max(0, totalDuration);

  function addClip(name: string, objectPath: string, sourceSec: number | null) {
    const startSec = Math.round(Math.max(0, Math.min(playheadSec, Math.max(0, total - MIN_AUDIO_CLIP_SEC))) * 100) / 100;
    const clip: AudioClip = {
      id: audioClipId(),
      name: name.slice(0, 120) || "Music clip",
      objectPath,
      startSec,
      durationSec: fitAudioDuration(startSec, 0, total, sourceSec ?? undefined),
      trimStart: 0,
      volume: DEFAULT_AUDIO_CLIP_VOLUME,
    };
    setClips((prev) => (prev.length >= MAX_AUDIO_CLIPS ? prev : [...prev, clip]));
    setSelectedId(clip.id);
  }

  async function addFromPath(name: string, objectPath: string, url: string) {
    const gen = genRef.current;
    const key = audioClipId();
    setPending((p) => [...p, { key, name }]);
    try {
      const known = sourceDurations[objectPath];
      const sec = known ?? (await probeAudioDuration(url));
      if (gen !== genRef.current) return;
      if (!sec) {
        toast({
          title: "Music clip not added",
          description: `"${name}" could not be read. Check your connection and try again, or upload the song as an MP3, WAV or M4A.`,
          variant: "destructive",
        });
        return;
      }
      onSourceDuration(objectPath, sec);
      addClip(name, objectPath, sec);
    } finally {
      if (gen === genRef.current) setPending((p) => p.filter((x) => x.key !== key));
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("audio/")) {
        toast({ title: "Not an audio file", description: `"${file.name}" is not a song or sound file.`, variant: "destructive" });
        continue;
      }
      const gen = genRef.current;
      const key = audioClipId();
      const name = file.name.replace(/\.[^.]+$/, "");
      setPending((p) => [...p, { key, name }]);
      const localUrl = URL.createObjectURL(file);
      try {
        const [sec, objectPath] = await Promise.all([probeAudioDuration(localUrl), uploadFile(file)]);
        if (gen !== genRef.current) return;
        if (!sec) throw new Error("This file could not be decoded. Try an MP3, WAV or M4A.");
        onSourceDuration(objectPath, sec);
        addClip(name, objectPath, sec);
      } catch (err) {
        if (gen !== genRef.current) return;
        toast({ title: "Music clip not added", description: err instanceof Error ? err.message : "Upload failed", variant: "destructive" });
      } finally {
        URL.revokeObjectURL(localUrl);
        if (gen === genRef.current) setPending((p) => p.filter((x) => x.key !== key));
      }
    }
  }

  const update = (id: string, patch: Partial<AudioClip>) =>
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const duplicate = (c: AudioClip) => {
    if (clips.length >= MAX_AUDIO_CLIPS) return;
    const startSec = Math.round(Math.min(Math.max(0, total - c.durationSec), c.startSec + c.durationSec) * 100) / 100;
    const copy = { ...c, id: audioClipId(), startSec };
    setClips((prev) => [...prev, copy]);
    setSelectedId(copy.id);
  };
  const remove = (id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const issueFor = (id: string) => issues.filter((i) => i.id === id);
  const globalIssues = issues.filter((i) => i.id === null);

  return (
    <div className="mb-4 rounded-lg border border-border bg-card p-4" data-testid="panel-audio-clips">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Music className="h-4 w-4 text-primary" /> Timed music clips
          <span className="text-xs font-normal text-muted-foreground">{clips.length}/{MAX_AUDIO_CLIPS}</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={atLimit} onClick={() => inputRef.current?.click()} data-testid="button-upload-audio-clip">
            <Upload className="mr-1 h-3.5 w-3.5" /> Upload song
          </Button>
          <SoundtrackPickerDialog onSelect={(t) => void addFromPath(t.title, t.objectPath, t.url)}>
            <Button size="sm" variant="outline" disabled={atLimit} data-testid="button-pick-audio-clip">
              <Library className="mr-1 h-3.5 w-3.5" /> From My Music
            </Button>
          </SoundtrackPickerDialog>
          {soundtrack?.objectPath && (
            <Button
              size="sm"
              variant="outline"
              disabled={atLimit}
              onClick={() => void addFromPath(soundtrack.name, soundtrack.objectPath, `/api/storage${soundtrack.objectPath}`)}
              data-testid="button-reuse-soundtrack-clip"
            >
              <Copy className="mr-1 h-3.5 w-3.5" /> Use soundtrack file
            </Button>
          )}
          <input ref={inputRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { void uploadFiles(e.target.files); e.target.value = ""; }} data-testid="input-audio-clip-file" />
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Play a song only for a set stretch, like a 5-second intro or a later musical moment. These are separate from the
        full-video soundtrack above, which keeps playing as usual. Clips start at the playhead, play once (no loop or fade) and
        up to {MAX_SIMULTANEOUS_AUDIO_CLIPS} can overlap.
      </p>

      {globalIssues.map((i, n) => (
        <p key={n} className="mb-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive" data-testid="text-audio-clip-issue">{i.message}</p>
      ))}

      {pending.map((p) => (
        <div key={p.key} className="mb-2 flex items-center gap-2 rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground" data-testid="status-audio-clip-pending">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing "{p.name}"…
        </div>
      ))}

      {clips.length === 0 && pending.length === 0 ? (
        <div className="rounded border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground" data-testid="empty-audio-clips">
          No timed music yet. Move the playhead, then upload a song or pick one from My Music.
        </div>
      ) : (
        <div className="space-y-2">
          {clips.map((c, i) => {
            const source = sourceDurations[c.objectPath];
            const clipIssues = issueFor(c.id);
            const selected = selectedId === c.id;
            return (
              <div
                key={c.id}
                className={`rounded-md border p-3 ${selected ? "border-primary" : "border-border"} ${clipIssues.length ? "bg-destructive/5" : ""}`}
                onClick={() => setSelectedId(c.id)}
                data-testid={`card-audio-clip-${c.id}`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">#{i + 1}</span>
                  <Input
                    value={c.name}
                    maxLength={120}
                    onChange={(e) => update(c.id, { name: e.target.value })}
                    className="h-8 flex-1 text-xs"
                    aria-label={`Music clip ${i + 1} name`}
                    data-testid={`input-audio-clip-name-${c.id}`}
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Duplicate (reuse this song)" onClick={(e) => { e.stopPropagation(); duplicate(c); }} disabled={clips.length >= MAX_AUDIO_CLIPS} data-testid={`button-duplicate-audio-clip-${c.id}`}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Delete clip" onClick={(e) => { e.stopPropagation(); remove(c.id); }} data-testid={`button-delete-audio-clip-${c.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SecondsField label="Starts at (s)" value={c.startSec} onCommit={(v) => update(c.id, { startSec: Math.max(0, v) })} testId={`input-audio-clip-start-${c.id}`} />
                  <SecondsField label="Plays for (s)" value={c.durationSec} min={MIN_AUDIO_CLIP_SEC} onCommit={(v) => update(c.id, { durationSec: v })} testId={`input-audio-clip-duration-${c.id}`} />
                  <SecondsField label="Song offset (s)" value={c.trimStart} onCommit={(v) => update(c.id, { trimStart: Math.max(0, v) })} testId={`input-audio-clip-offset-${c.id}`} />
                  <div className="text-[11px] text-muted-foreground">
                    Volume {Math.round(c.volume * 100)}%
                    <Slider
                      className="mt-3"
                      min={0}
                      max={1}
                      step={0.01}
                      value={[c.volume]}
                      onValueChange={([v]) => update(c.id, { volume: v ?? 0 })}
                      aria-label={`Music clip ${i + 1} volume`}
                      data-testid={`slider-audio-clip-volume-${c.id}`}
                    />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span data-testid={`text-audio-clip-range-${c.id}`}>Timeline {fmt(c.startSec)}–{fmt(c.startSec + c.durationSec)}</span>
                  <span>Song {fmt(c.trimStart)}–{fmt(c.trimStart + c.durationSec)}{source ? ` of ${fmt(source)}` : ""}</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    onClick={(e) => { e.stopPropagation(); update(c.id, { startSec: Math.round(Math.max(0, playheadSec) * 100) / 100 }); }}
                    data-testid={`button-audio-clip-at-playhead-${c.id}`}
                  >
                    <Clock className="h-3 w-3" /> Start at playhead
                  </button>
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={(e) => { e.stopPropagation(); update(c.id, { durationSec: fitAudioDuration(c.startSec, c.trimStart, total, source, Number.POSITIVE_INFINITY) }); }}
                    data-testid={`button-audio-clip-fit-${c.id}`}
                  >
                    Fit to song / video end
                  </button>
                </div>
                {c.objectPath && sourceErrors[c.objectPath] && (
                  <p className="mt-2 text-xs text-destructive" data-testid={`text-audio-clip-source-error-${c.id}`}>
                    This song could not be loaded for preview. It may be missing or unreadable; delete the clip and add the song again.
                  </p>
                )}
                {clipIssues.map((issue, n) => (
                  <p key={n} className="mt-2 text-xs text-destructive" data-testid={`text-audio-clip-issue-${c.id}`}>{issue.message}</p>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
