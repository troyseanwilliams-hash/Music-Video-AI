import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  calculateLipsyncCost, LIPSYNC_MAX_SECONDS, LIPSYNC_CREDITS_PER_SECOND, LYRIC_ALIGN_COST, LYRIC_OVERLAY_COST,
} from "@/lib/creditPricing";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LYRICSYNC_PUBLIC } from "@/lib/featureFlags";
import { SoundtrackPickerDialog, type PickedSoundtrack } from "@/components/SoundtrackPickerDialog";
import {
  Mic2, Music2, Wand2, Play, Pause, Upload, Smile, Copy, Type, Clock,
  ChevronLeft, ChevronRight, Info, AlertTriangle, Loader2, Film,
} from "lucide-react";

type PickedVideo = { id: string; title: string; url: string; durationSeconds: number | null };

/** Minimal "pick one of my videos" dialog (thumbnail grid from /api/videos). */
function VideoPickerDialog({ children, onSelect }: { children: React.ReactNode; onSelect: (v: PickedVideo) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState<Array<{
    id: string; title: string | null; thumbnailObjectPath: string | null;
    videoObjectPath: string; durationSeconds: number | null;
  }>>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/videos?limit=30", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((d) => setVideos(d.videos ?? []))
      .catch(() => setVideos([]))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Pick a video</DialogTitle></DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : videos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No videos in your library yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 max-h-[50vh] overflow-auto pr-1">
            {videos.map((v) => (
              <button
                key={v.id}
                className="group relative aspect-[9/16] overflow-hidden rounded-lg border border-border bg-background/50 hover:border-primary"
                onClick={() => {
                  onSelect({
                    id: v.id,
                    title: v.title ?? "Untitled video",
                    url: `/api/storage${v.videoObjectPath}`,
                    durationSeconds: v.durationSeconds,
                  });
                  setOpen(false);
                }}
              >
                {v.thumbnailObjectPath ? (
                  <img src={`/api/storage${v.thumbnailObjectPath}`} alt={v.title ?? "Video"} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Film className="h-6 w-6" /></div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                  <div className="truncate text-[11px] font-medium text-white">{v.title ?? "Untitled"}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * AILyricSync — Lyric + Lip Sync Studio (Beta · Admin-only)
 * ---------------------------------------------------------
 * A proof-of-concept authoring studio that sits inside the Admin tab. It is NOT
 * exposed to the public — it lives behind the existing /admin auth gate, and the
 * `LYRICSYNC_PUBLIC` flag below is the single switch to later promote it.
 *
 * What it does (all client-side for the POC):
 *   1. Load a song (file) and paste its lyrics.
 *   2. Auto-sync — distribute lines/words across the real audio duration and emit
 *      the app's native LRC karaoke format ([mm:ss.xx] lines + <mm:ss.xx> words),
 *      which the existing Generate pipeline already consumes as `lyricsText`.
 *   3. Preview karaoke live, synced to real playback; nudge any line's timing.
 *   4. Configure an optional lip-synced performer (reuses the OmniHuman concept).
 *   5. Copy the generated LRC straight into Generate, or (stub) send to render.
 */

type Word = { w: string; t: number };
type Line = { start: number; words: Word[] };

const FALLBACK_DURATION = 30;
const START_PAD = 0.5;

const PRESETS = [
  { key: "karaoke", label: "Karaoke highlight" },
  { key: "reveal", label: "Line reveal" },
  { key: "kinetic", label: "Kinetic type" },
] as const;
type Preset = (typeof PRESETS)[number]["key"];

const POSITIONS = [
  { key: "lower", label: "Lower third" },
  { key: "center", label: "Centered" },
  { key: "full", label: "Full frame" },
] as const;
type Position = (typeof POSITIONS)[number]["key"];

const COLORS = [
  { key: "#ffffff", label: "White" },
  { key: "hsl(var(--primary))", label: "Brand" },
  { key: "#f59e0b", label: "Amber" },
  { key: "#38bdf8", label: "Cyan" },
];

const SAMPLE = `In a world that runs on ones and zeroes
I got a heart that beats in something slower
No wifi for the way I feel
Just an old, unsteady, human, real
I got an analog heart
In a digital dark
Beating out of time
Beating out of line`;

function two(n: number) { return String(Math.floor(n)).padStart(2, "0"); }
function fmtLrc(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  return `${two(m)}:${two(s)}.${two(cs)}`;
}
function fmtClock(t: number) {
  if (!isFinite(t) || t < 0) t = 0;
  return `${Math.floor(t / 60)}:${two(t % 60)}`;
}

/** Strip existing [..]/<..> tags and section labels, return plain lyric lines. */
function toPlainLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) => l.replace(/\[[^\]]*\]/g, "").replace(/<[^>]*>/g, "").trim())
    .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l));
}

/** Evenly distribute lines + words across the duration → timed structure. */
function autoSync(raw: string, duration: number): Line[] {
  const plain = toPlainLines(raw);
  if (plain.length === 0) return [];
  const usable = Math.max(4, duration - START_PAD);
  const slice = usable / plain.length;
  return plain.map((line, i) => {
    const start = START_PAD + i * slice;
    const words = line.split(/\s+/).filter(Boolean);
    const wSlice = (slice * 0.9) / words.length;
    return {
      start,
      words: words.map((w, j) => ({ w, t: start + j * wSlice })),
    };
  });
}

/** Serialize timed lines back to the app's native LRC karaoke format. */
function toLrc(lines: Line[]): string {
  return lines
    .map((ln) => {
      const head = `[${fmtLrc(ln.start)}]`;
      const body = ln.words.map((wd) => `<${fmtLrc(wd.t)}>${wd.w}`).join(" ");
      return head + body;
    })
    .join("\n");
}

/** Parse enhanced LRC ([mm:ss.xx]<mm:ss.xx>word) back into the editor's Line[]. */
function parseLrcToLines(lrc: string): Line[] {
  const toSec = (m: string, s: string, c?: string) =>
    parseInt(m, 10) * 60 + parseInt(s, 10) + (c ? parseInt(c.padEnd(2, "0").slice(0, 2), 10) / 100 : 0);
  const out: Line[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const head = raw.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/);
    if (!head) continue;
    const start = toSec(head[1], head[2], head[3]);
    const words: Word[] = [];
    const re = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>([^<]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const t = toSec(m[1], m[2], m[3]);
      const w = m[4].trim();
      if (w) words.push({ w, t });
    }
    if (words.length === 0) {
      const body = raw.replace(/\[[^\]]*\]/g, "").replace(/<[^>]*>/g, "").trim();
      body.split(/\s+/).filter(Boolean).forEach((w, i) => words.push({ w, t: start + i * 0.35 }));
    }
    if (words.length) out.push({ start, words });
  }
  return out;
}

/** Upload the local audio to object storage → objectPath, so the server can
 *  hand a signed URL to the alignment engine. Mirrors LipSyncPanel. */
export async function presignAndUpload(file: File): Promise<string> {
  const res = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) throw new Error("Could not get an upload URL");
  const { uploadURL, objectPath } = (await res.json()) as { uploadURL: string; objectPath: string };
  const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return objectPath;
}

/**
 * Draggable lip-sync window over the song's waveform. Grab the highlighted
 * region and drag it anywhere along the bar (mouse or touch); clicking
 * outside the region jumps it there. Width is fixed at `windowSeconds`
 * (5-30s, set by the Clip length buttons) — this only moves WHERE that
 * window starts. Live-seeks the preview during drag via onScrub so you can
 * hear/see the spot before letting go.
 */
export function LipWindowScrubber({
  duration,
  peaks,
  windowStart,
  windowSeconds,
  now,
  disabled,
  onChange,
  onScrub,
}: {
  duration: number;
  peaks: number[];
  windowStart: number;
  windowSeconds: number;
  now: number;
  disabled: boolean;
  onChange: (start: number) => void;
  onScrub: (start: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef(0); // time between the grabbed point and windowStart

  const maxStart = Math.max(0, duration - windowSeconds);
  const clamp = (t: number) => Math.min(Math.max(0, t), maxStart);

  const timeAtClientX = useCallback((clientX: number) => {
    const bar = barRef.current;
    if (!bar || duration <= 0) return 0;
    const r = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return frac * duration;
  }, [duration]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    const clickT = timeAtClientX(e.clientX);
    const insideWindow = clickT >= windowStart && clickT <= windowStart + windowSeconds;
    // Grabbing inside the highlighted region drags from that exact point;
    // clicking outside it snaps the window to be centered under the cursor.
    dragOffsetRef.current = insideWindow ? clickT - windowStart : windowSeconds / 2;
    const start = clamp(clickT - dragOffsetRef.current);
    setDragging(true);
    onChange(start);
    onScrub(start);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [disabled, duration, windowStart, windowSeconds, timeAtClientX, onChange, onScrub]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const t = timeAtClientX(e.clientX);
    const start = clamp(t - dragOffsetRef.current);
    onChange(start);
    onScrub(start);
  }, [dragging, timeAtClientX, onChange, onScrub]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, [dragging]);

  const bars = peaks.length ? peaks : Array.from({ length: 120 }, () => 0.3);
  const selStartPct = duration > 0 ? (windowStart / duration) * 100 : 0;
  const selWidthPct = duration > 0 ? (Math.min(windowSeconds, duration - windowStart) / duration) * 100 : 0;
  const playheadPct = duration > 0 ? (now / duration) * 100 : 0;

  return (
    <div
      ref={barRef}
      className={`relative flex items-end gap-[2px] h-14 rounded-lg bg-background/50 border border-border p-2 overflow-hidden touch-none select-none ${disabled ? "opacity-40" : "cursor-grab active:cursor-grabbing"}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="slider"
      aria-label="Lip sync window position"
      aria-valuemin={0}
      aria-valuemax={maxStart}
      aria-valuenow={windowStart}
    >
      {bars.map((p, i) => {
        const barT = (i / bars.length) * duration;
        const inSel = barT >= windowStart && barT <= windowStart + windowSeconds;
        return (
          <div
            key={i}
            className={`flex-1 min-w-[2px] rounded-sm pointer-events-none ${inSel ? "bg-amber-500" : "bg-muted-foreground/30"}`}
            style={{ height: `${Math.max(8, p * 100)}%` }}
          />
        );
      })}
      <div
        className="absolute top-0 bottom-0 rounded-md border-2 border-amber-400 bg-amber-400/10 pointer-events-none"
        style={{ left: `${selStartPct}%`, width: `${selWidthPct}%` }}
      />
      <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/70 pointer-events-none" style={{ left: `${playheadPct}%` }} />
    </div>
  );
}

export default function LyricSyncStudio({ variant = "admin" }: { variant?: "admin" | "public" }) {
  const { toast } = useToast();

  // ── Source audio ──
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [duration, setDuration] = useState(FALLBACK_DURATION);
  const [peaks, setPeaks] = useState<number[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioFileRef = useRef<HTMLInputElement | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [libObjectPath, setLibObjectPath] = useState<string | null>(null); // set when picked from library
  const [pickedVideo, setPickedVideo] = useState<PickedVideo | null>(null); // set when syncing to a finished video
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [burning, setBurning] = useState(false);

  // ── Lyrics + timing ──
  const [lyrics, setLyrics] = useState(SAMPLE);
  const [lines, setLines] = useState<Line[]>([]);
  const [synced, setSynced] = useState(false);

  // ── Playback ──
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const rafRef = useRef<number | null>(null);
  const simClock = useRef(0);
  const lastTs = useRef(0);

  // ── Style ──
  const [lipEnabled, setLipEnabled] = useState(false);
  const [rightsAcknowledged, setRightsAcknowledged] = useState(false);
  const [preset, setPreset] = useState<Preset>("karaoke");
  const [position, setPosition] = useState<Position>("center");
  const [color, setColor] = useState(COLORS[0].key);
  const [size, setSize] = useState(30);

  // ── Lip sync (premium add-on) — only the two values the API actually accepts:
  //    a face image + a clip length (5–30s). No strength/placement (OmniHuman
  //    takes image + audio only). Runs at export via POST /api/videos/:id/lipsync.
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [lipSeconds, setLipSeconds] = useState(15);
  // Which part of the song/video to sync to — defaults to the very start, but
  // the range control below lets the admin pick any lipSeconds-wide window.
  const [lipStartTime, setLipStartTime] = useState(0);
  const faceInputRef = useRef<HTMLInputElement | null>(null);
  const [lipResult, setLipResult] = useState<{ videoId: string; url: string } | null>(null);
  // Set only when the real, paid vocal-read alignment (runSync) fails — kept
  // separate from toasts (which are easy to miss) so the studio makes it
  // unmistakable that what's in the Lyrics box, if anything, is NOT actually
  // read from the song, and lets the admin explicitly opt into the free
  // even-spread fallback instead of it happening silently.
  const [syncError, setSyncError] = useState<string | null>(null);

  // Any source change: stop whatever was playing and rewind the clock, so the
  // new source never appears "playing" while the old one keeps going.
  const resetPlayback = useCallback(() => {
    audioRef.current?.pause();
    videoRef.current?.pause();
    setPlaying(false);
    simClock.current = 0;
    setNow(0);
  }, []);

  const lrc = useMemo(() => toLrc(lines), [lines]);
  const lipCost = calculateLipsyncCost(lipSeconds); // same 1.5× margin as everything else
  const jobCost = LYRIC_ALIGN_COST + (lipEnabled ? lipCost : 0); // add-ons this studio controls
  // The latest a lipSeconds-wide window can start without running past the
  // end of the loaded song/video.
  const lipStartMax = Math.max(0, duration - lipSeconds);
  // Keep the window in range as lipSeconds or the source (with its own
  // duration) changes — e.g. picking a longer clip length after already
  // scrubbing near the end of a short song.
  useEffect(() => {
    setLipStartTime((t) => Math.min(t, lipStartMax));
  }, [lipStartMax]);

  // Load audio file → object URL + duration + waveform peaks.
  const onAudioFile = useCallback(async (file: File) => {
    resetPlayback();
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setAudioName(file.name);
    setAudioFile(file);
    setLibObjectPath(null); // uploading replaces any library selection
    setPickedVideo(null);
    setSynced(false);
    setLines([]);
    setSyncError(null);
    // Try to decode real peaks; fall back to a synthetic waveform.
    try {
      const buf = await file.arrayBuffer();
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const decoded = await ctx.decodeAudioData(buf);
      setDuration(decoded.duration);
      const ch = decoded.getChannelData(0);
      const N = 120;
      const block = Math.floor(ch.length / N);
      const out: number[] = [];
      for (let i = 0; i < N; i++) {
        let peak = 0;
        for (let j = 0; j < block; j += 64) peak = Math.max(peak, Math.abs(ch[i * block + j] || 0));
        out.push(peak);
      }
      const max = Math.max(...out, 0.01);
      setPeaks(out.map((v) => v / max));
      ctx.close();
    } catch {
      setPeaks(Array.from({ length: 120 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 0.5)) * 0.6));
    }
  }, []);

  // Pick a song from the user's own library — already in object storage, so we
  // align it directly (no upload). Duration comes from the <audio> metadata.
  const onPickLibrary = useCallback((t: PickedSoundtrack) => {
    resetPlayback();
    setAudioUrl(t.url);
    setAudioName(t.title);
    setAudioFile(null);
    setLibObjectPath(t.objectPath);
    setPickedVideo(null);
    setSynced(false);
    setLines([]);
    setSyncError(null);
    setPeaks(Array.from({ length: 120 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 0.5)) * 0.6));
  }, []);

  // Pick one of the user's finished videos — its audio drives alignment, the
  // video itself plays behind the karaoke preview, and Burn writes onto it.
  const onPickVideo = useCallback((v: PickedVideo) => {
    resetPlayback();
    setPickedVideo(v);
    setAudioUrl(null);
    setAudioName(v.title);
    setAudioFile(null);
    setLibObjectPath(null);
    setSynced(false);
    setLines([]);
    setSyncError(null);
    if (v.durationSeconds) setDuration(v.durationSeconds);
    setPeaks(Array.from({ length: 120 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 0.5)) * 0.6));
  }, []);

  // Client-side fallback: spread lines evenly across the track (no vocal read).
  const estimateSync = useCallback(() => {
    const d = audioRef.current?.duration && isFinite(audioRef.current.duration)
      ? audioRef.current.duration
      : duration;
    const result = autoSync(lyrics, d);
    if (result.length === 0) {
      toast({ title: "Add some lyrics first", variant: "destructive" });
      return;
    }
    setLines(result);
    setSynced(true);
    toast({ title: "Estimated timing", description: `${result.length} lines spread across ${fmtClock(d)}. Nudge to fine-tune.` });
  }, [lyrics, duration, toast]);

  // Real sync: read the loaded song's vocal and align word-by-word via
  // /api/lyrics/align (AssemblyAI). This is the ONLY path that actually
  // listens to the track — on failure it surfaces a clear, sticky error
  // instead of silently swapping in the free even-spread estimate, which
  // used to look like a successful real sync when it wasn't. The admin
  // explicitly clicks "Estimate (free)" if they want that fallback instead.
  const runSync = useCallback(async () => {
    setSyncError(null);
    if (!audioFile && !libObjectPath && !pickedVideo) {
      setSyncError("Load a song first — upload a file, pick one from your Library, or pick a video — then Auto-sync can read its vocal.");
      return;
    }
    setSyncing(true);
    try {
      const body: Record<string, unknown> = { lyricsText: lyrics.trim() || null, acceptCopyright: rightsAcknowledged };
      if (pickedVideo) body.videoId = pickedVideo.id;
      else body.audioObjectPath = libObjectPath ?? (await presignAndUpload(audioFile!));
      const res = await fetch("/api/lyrics/align", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Alignment failed");
      const parsed = parseLrcToLines(data.lrc || "");
      if (parsed.length === 0) throw new Error("No timing returned");
      setLines(parsed);
      setSynced(true);
      // ASR mode (no lyrics provided): the vocal was transcribed — put the
      // generated lyrics into the box so the user can see and edit them.
      if (data.source === "asr") {
        setLyrics(parsed.map((ln) => ln.words.map((w) => w.w).join(" ")).join("\n"));
      }
      toast({
        title: data.lowConfidence ? "Synced — low confidence" : "Synced to vocal",
        description: data.lowConfidence
          ? `${parsed.length} lines aligned, but confidence was low — check the timing.`
          : `${parsed.length} lines aligned to the vocal. Nudge any line to fine-tune.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Vocal alignment failed.";
      setSyncError(message);
      toast({ title: "Vocal read failed — nothing was synced", description: message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }, [audioFile, libObjectPath, pickedVideo, lyrics, rightsAcknowledged, toast]);

  // Unified playback clock (real audio when present, else a sim clock).
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    lastTs.current = performance.now();
    const tick = (ts: number) => {
      const dt = (ts - lastTs.current) / 1000;
      lastTs.current = ts;
      let t: number;
      if (pickedVideo && videoRef.current) {
        t = videoRef.current.currentTime;
      } else if (audioRef.current && audioUrl) {
        t = audioRef.current.currentTime;
      } else {
        simClock.current = Math.min(duration, simClock.current + dt);
        t = simClock.current;
      }
      setNow(t);
      if (t >= duration - 0.05 && !audioUrl && !pickedVideo) { setPlaying(false); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, audioUrl, pickedVideo, duration]);

  const togglePlay = useCallback(() => {
    // Play never triggers the paid alignment API — if nothing is synced yet,
    // spread the lines for free so the preview still shows something.
    if (!synced) estimateSync();
    const media = pickedVideo ? videoRef.current : (audioUrl ? audioRef.current : null);
    if (media) {
      if (playing) media.pause();
      else media.play().catch(() => {});
    } else if (!playing) {
      if (simClock.current >= duration - 0.05) simClock.current = 0;
    }
    setPlaying((p) => !p);
  }, [synced, estimateSync, playing, audioUrl, pickedVideo, duration]);

  const seek = useCallback((t: number) => {
    t = Math.max(0, Math.min(duration, t));
    const media = pickedVideo ? videoRef.current : (audioUrl ? audioRef.current : null);
    if (media) media.currentTime = t;
    simClock.current = t;
    setNow(t);
  }, [duration, audioUrl, pickedVideo]);

  const nudge = useCallback((idx: number, delta: number) => {
    setLines((prev) => prev.map((ln, i) => {
      if (i !== idx) return ln;
      const start = Math.max(0, ln.start + delta);
      return { start, words: ln.words.map((w) => ({ ...w, t: Math.max(0, w.t + delta) })) };
    }));
  }, []);

  // Active line/word for the current time.
  const activeIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) if (now >= lines[i].start) idx = i;
    return idx;
  }, [lines, now]);

  const current = activeIdx >= 0 ? lines[activeIdx] : null;
  const next = activeIdx + 1 < lines.length ? lines[activeIdx + 1] : null;

  const copyLrc = () => {
    navigator.clipboard?.writeText(lrc).then(
      () => toast({ title: "LRC copied", description: "Paste into Generate → Lyric video · karaoke captions." }),
      () => toast({ title: "Copy failed", variant: "destructive" }),
    );
  };

  // Burn the synced lyrics onto the picked video, then (if the lip-sync
  // add-on is on) run the lip-sync performer on top of THAT result — so the
  // final video carries both. Either step can run alone: lyrics-only if
  // lipEnabled is off, lip-sync-only if there are no synced lines yet. As an
  // admin, both legs of this run through the same routes real users hit
  // (POST /api/videos/:id/lyrics, POST /api/videos/:id/lipsync) — the server
  // already waives credits for admins (see isAdminEmail in routes/teasers.ts
  // and routes/videos.ts), so this studio gives full, unmetered access to
  // both pipelines for testing.
  const burnOnVideo = useCallback(async () => {
    if (!pickedVideo) return;
    if (!lrc && !(lipEnabled && faceFile)) return;
    setBurning(true);
    setLipResult(null);
    try {
      let targetVideoId = pickedVideo.id;
      let targetTitle = pickedVideo.title;

      if (lrc) {
        const res = await fetch(`/api/videos/${targetVideoId}/lyrics`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lyricsText: lrc, acceptCopyright: rightsAcknowledged }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lyric burn failed");
        toast({
          title: "Lyrics burned onto the video",
          description: `Saved to your library as a new video (${data.charged} credits). The original is untouched.`,
        });
        if (data.videoId) {
          targetVideoId = data.videoId;
          targetTitle = `${targetTitle ?? "Video"} — lyrics`;
        }
      }

      if (lipEnabled && faceFile) {
        const imageObjectPath = await presignAndUpload(faceFile);
        const res = await fetch(`/api/videos/${targetVideoId}/lipsync`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageObjectPath, lipsyncSeconds: lipSeconds, lipsyncStartTime: lipStartTime }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lip sync failed");
        setLipResult({ videoId: data.videoId, url: data.url });
        toast({
          title: "Lip sync rendered",
          description: `Saved to your library as “${targetTitle} — lip sync” (${data.creditsCharged} credits).`,
        });
      }
    } catch (err) {
      toast({
        title: lipEnabled && faceFile ? "Lip sync failed" : "Burn failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBurning(false);
    }
  }, [pickedVideo, lrc, lipEnabled, faceFile, lipSeconds, lipStartTime, rightsAcknowledged, toast]);

  const stubRender = () => {
    toast({
      title: "Pick a video first",
      description: "Choose one of your videos (My Videos) to burn these lyrics onto, or copy the LRC into Generate.",
    });
  };

  return (
    <div className="space-y-4">
      {/* Internal banner — admin view only */}
      {variant === "admin" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
          <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
          <p className="text-sm">
            <span className="font-semibold">Admin preview.</span>{" "}
            <span className="text-muted-foreground">
              Public rollout is gated by <code className="text-xs bg-muted/40 px-1 rounded">VITE_LYRICSYNC_PUBLIC</code>. Currently{" "}
              <span className={LYRICSYNC_PUBLIC ? "text-emerald-500" : "text-amber-500"}>{LYRICSYNC_PUBLIC ? "PUBLIC" : "ADMIN-ONLY"}</span>.
            </span>
          </p>
        </div>
      )}

      <Card className="bg-card/50 border-card-border overflow-hidden">
        <div className="h-1 w-full bg-gradient-electric" />
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mic2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg leading-tight">Lyric Sync</CardTitle>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant="outline" className="text-[10px]">{variant === "admin" ? "Beta · Admin" : "Beta"}</Badge>
                <span className="text-[10px] text-muted-foreground">AILyricSync</span>
              </div>
            </div>
          </div>
          <CardDescription className="mt-2">
            Sync words to the vocal{variant === "admin" ? " and (optionally) drive a lip-synced performer" : ""}. Outputs
            the app's native LRC karaoke format, ready for the Generate pipeline.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Lip Sync is an optional setting on Lyric Sync — admin-only while the
              feature is pulled from public surfaces. */}
          {variant === "admin" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <Smile className="h-4 w-4 text-primary" />
              <span className="font-medium">Add a lip-synced performer</span>
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">Premium add-on</Badge>
            </div>
            <div className="flex items-center gap-2.5">
              {lipEnabled && <span className="text-xs font-semibold text-amber-500">+{lipCost} credits</span>}
              <Switch checked={lipEnabled} onCheckedChange={setLipEnabled} aria-label="Add a lip-synced performer" />
            </div>
          </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {/* LEFT: inputs */}
            <div className="space-y-4">
              {/* Audio */}
              <div>
                <Label className="mb-1.5 flex items-center gap-1.5"><Music2 className="h-4 w-4 text-primary" /> Song</Label>
                <input ref={audioFileRef} type="file" accept="audio/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onAudioFile(f); e.target.value = ""; }} />
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-background/40 p-3">
                  <div className="h-11 w-11 rounded-md bg-primary/10 flex items-center justify-center text-primary">♫</div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{audioName ?? "No song loaded"}</div>
                    <div className="text-xs text-muted-foreground">{audioName ? `${fmtClock(duration)} · ready` : "Upload a file or pick from your library"}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2 shrink-0">
                    <VideoPickerDialog onSelect={onPickVideo}>
                      <Button variant="outline" size="sm"><Film className="mr-1.5 h-3.5 w-3.5" /> My Videos</Button>
                    </VideoPickerDialog>
                    <SoundtrackPickerDialog onSelect={onPickLibrary}>
                      <Button variant="outline" size="sm"><Music2 className="mr-1.5 h-3.5 w-3.5" /> Library</Button>
                    </SoundtrackPickerDialog>
                    <Button variant="outline" size="sm" onClick={() => audioFileRef.current?.click()}>
                      <Upload className="mr-1.5 h-3.5 w-3.5" /> {audioName ? "Change" : "Upload"}
                    </Button>
                  </div>
                </div>
                {audioUrl && (
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || FALLBACK_DURATION)}
                    onEnded={() => setPlaying(false)}
                    className="hidden"
                  />
                )}
              </div>

              {/* Lyrics */}
              <div>
                <Label className="mb-1.5 flex items-center gap-1.5"><Type className="h-4 w-4 text-primary" /> Lyrics</Label>
                <Textarea
                  value={lyrics}
                  onChange={(e) => { setLyrics(e.target.value); setSynced(false); setSyncError(null); }}
                  className="min-h-[150px] resize-none bg-background/50"
                  maxLength={5000}
                  placeholder="Paste plain lyrics — one line each. Section tags like [Chorus] are ignored for timing."
                />
                <div className="flex items-center gap-2 mt-2">
                  <Button onClick={runSync} disabled={syncing || !rightsAcknowledged} className="gap-1.5">
                    {syncing
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading vocal…</>
                      : <><Wand2 className="h-4 w-4" /> {lyrics.trim() ? "Auto-sync timing" : "Generate lyrics from vocal"} · {LYRIC_ALIGN_COST} credits</>}
                  </Button>
                  <Button variant="outline" onClick={estimateSync} disabled={syncing} className="gap-1.5">
                    Estimate (free)
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {syncing ? "aligning to the song…" : synced ? `${lines.length} lines synced` : "not synced yet"}
                  </span>
                </div>
                {syncError && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <p className="text-xs text-destructive">{syncError}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Nothing was synced and no credits were charged (refunded automatically on failure).{" "}
                        {lyrics.trim() && (
                          <button
                            type="button"
                            onClick={() => { estimateSync(); setSyncError(null); }}
                            className="font-medium text-primary hover:underline"
                          >
                            Use estimated timing instead (free)
                          </button>
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Rights disclaimer — lyrics are copyrighted separately from the
                  recording, so karaoke burns need an explicit attestation. */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                  <span>
                    <span className="font-medium text-foreground/90">Lyrics are copyrighted works</span> — separately
                    from the recording itself. Displaying or distributing someone else's lyrics in a karaoke video
                    generally requires a license from the songwriter or publisher. Only sync and burn lyrics for music
                    you wrote, own, or have licensed (including AI-generated songs made in this app).
                  </span>
                </p>
                <label className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={rightsAcknowledged}
                    onChange={(e) => setRightsAcknowledged(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary cursor-pointer"
                  />
                  <span className="text-xs text-muted-foreground leading-relaxed group-hover:text-foreground/80 transition-colors">
                    I confirm I have the rights to this song <em>and</em> its lyrics (owned, licensed, or created here).
                  </span>
                </label>
              </div>

              {/* Timeline / editor */}
              <div>
                <Label className="mb-1.5 flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary" /> Lyric timeline</Label>
                {/* Waveform */}
                <div
                  className="relative flex items-end gap-[2px] h-16 rounded-lg bg-background/50 border border-border p-2 overflow-hidden cursor-pointer"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    seek(((e.clientX - r.left) / r.width) * duration);
                  }}
                >
                  {(peaks.length ? peaks : Array.from({ length: 120 }, () => 0.3)).map((p, i) => {
                    const barT = (i / (peaks.length || 120)) * duration;
                    const on = barT <= now;
                    return <div key={i} className={`flex-1 min-w-[2px] rounded-sm ${on ? "bg-primary" : "bg-muted-foreground/30"}`} style={{ height: `${Math.max(8, p * 100)}%` }} />;
                  })}
                  <div className="absolute top-0 bottom-0 w-0.5 bg-foreground shadow" style={{ left: `${(now / duration) * 100}%` }} />
                </div>
                {/* Lines */}
                <div className="mt-2 space-y-1.5 max-h-52 overflow-auto pr-1">
                  {lines.length === 0 && (
                    <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border bg-background/40 px-3 py-4 text-center">
                      Click <b>Auto-sync timing</b> to align each line. You can nudge start times after.
                    </p>
                  )}
                  {lines.map((ln, i) => (
                    <div key={i} className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${i === activeIdx ? "border-primary bg-primary/10" : "border-border bg-background/40"}`}>
                      <button className="text-primary hover:opacity-70" onClick={() => nudge(i, -0.1)} aria-label="earlier"><ChevronLeft className="h-3.5 w-3.5" /></button>
                      <span className="font-mono text-xs text-primary tabular-nums w-14 text-center cursor-pointer" onClick={() => seek(ln.start)}>{fmtLrc(ln.start)}</span>
                      <button className="text-primary hover:opacity-70" onClick={() => nudge(i, 0.1)} aria-label="later"><ChevronRight className="h-3.5 w-3.5" /></button>
                      <span className="truncate text-muted-foreground">{ln.words.map((w) => w.w).join(" ")}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT: preview + style */}
            <div className="space-y-4">
              {/* Preview */}
              <div>
                <Label className="mb-1.5">Preview</Label>
                <div className="relative mx-auto aspect-[9/16] max-h-[440px] w-full overflow-hidden rounded-2xl border border-border bg-[radial-gradient(120%_80%_at_50%_0%,hsl(var(--primary)/0.18),#0a0c12)] flex flex-col items-center justify-end">
                  {pickedVideo && (
                    <video
                      ref={videoRef}
                      src={pickedVideo.url}
                      playsInline
                      onLoadedMetadata={(e) => { if (isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); }}
                      onEnded={() => setPlaying(false)}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                  <div className="absolute top-2 right-3 text-[10px] text-white/50">AIBeatSync</div>
                  {lipEnabled && (
                    <div className="absolute top-2 left-3 text-[10px] text-amber-400/80">Lip sync renders at export · no live preview</div>
                  )}
                  <div
                    className={`relative z-10 w-full px-5 text-center ${position === "lower" ? "pb-12" : position === "full" ? "pb-0 mb-auto mt-auto" : "pb-0 my-auto"}`}
                    style={{ transform: preset === "kinetic" && playing ? `scale(${1 + 0.04 * Math.sin(now * 6)})` : "none" }}
                  >
                    <div className="font-extrabold leading-tight" style={{ fontSize: `${size}px`, color, textShadow: "0 2px 18px rgba(0,0,0,.7)" }}>
                      {current
                        ? current.words.map((wd, j) => {
                            const done = preset === "reveal" ? true : now >= wd.t;
                            return <span key={j} style={{ opacity: done ? 1 : 0.32, transition: "opacity .12s" }}>{wd.w}{" "}</span>;
                          })
                        : <span style={{ opacity: 0.4 }}>Press play to preview</span>}
                    </div>
                    {next && <div className="mt-2 text-sm text-white/60">{next.words.map((w) => w.w).join(" ")}</div>}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-center gap-3">
                  <Button onClick={togglePlay} className="gap-1.5">{playing ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Play</>}</Button>
                  <span className="text-xs text-muted-foreground tabular-nums">{fmtClock(now)} / {fmtClock(duration)}</span>
                </div>
              </div>

              {/* Lyric style */}
              <div className="rounded-xl border border-border bg-background/30 p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lyric style</div>
                <div>
                  <Label className="text-xs text-muted-foreground">Animation preset</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => (
                      <button key={p.key} onClick={() => setPreset(p.key)}
                        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${preset === p.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>{p.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Position</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {POSITIONS.map((p) => (
                      <button key={p.key} onClick={() => setPosition(p.key)}
                        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${position === p.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>{p.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Text color</Label>
                  <div className="mt-1.5 flex gap-2">
                    {COLORS.map((c) => (
                      <button key={c.key} onClick={() => setColor(c.key)} aria-label={c.label}
                        className={`h-6 w-6 rounded-md border-2 ${color === c.key ? "border-foreground" : "border-transparent"}`} style={{ background: c.key }} />
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Size · {size}px</Label>
                  <Slider className="mt-2" value={[size]} min={16} max={44} step={1} onValueChange={([v]) => setSize(v)} />
                </div>
              </div>

              {/* Lip sync — premium add-on. Only the values the API accepts. */}
              {lipEnabled && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Smile className="h-4 w-4 text-primary" /> Lip-sync performer
                    </div>
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">Premium add-on</Badge>
                  </div>
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <span>
                      Animates a face to sing your track with OmniHuman — an expensive video model, so it's an{" "}
                      <span className="text-amber-500 font-medium">upcharge</span>, billed per second at the standard margin.
                      It renders at export on the video's own audio (<code className="bg-muted/40 px-1 rounded">POST /api/videos/:id/lipsync</code>).
                    </span>
                  </p>

                  {/* Face image (real API input: imageObjectPath) */}
                  <input ref={faceInputRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) { setFaceFile(f); setFacePreview(URL.createObjectURL(f)); setLipResult(null); }
                      e.target.value = "";
                    }} />
                  <div>
                    <Label className="text-xs text-muted-foreground">Face image</Label>
                    <div className="mt-1.5 flex items-center gap-3">
                      <Button variant="outline" size="sm" onClick={() => faceInputRef.current?.click()}>
                        <Upload className="mr-1.5 h-3.5 w-3.5" /> {facePreview ? "Change face" : "Upload face"}
                      </Button>
                      {facePreview
                        ? <img src={facePreview} alt="Uploaded performer face" className="h-12 w-12 rounded-md border border-border object-cover" />
                        : <span className="text-[11px] text-muted-foreground">Front-facing, well-lit, one person.</span>}
                    </div>
                  </div>

                  {/* Clip length (real API input: lipsyncSeconds) */}
                  <div>
                    <Label className="text-xs text-muted-foreground">Clip length · {lipSeconds}s (max {LIPSYNC_MAX_SECONDS}s)</Label>
                    <div className="mt-1.5 grid grid-cols-5 gap-2">
                      {[5, 10, 15, 20, 30].map((s) => (
                        <button key={s} onClick={() => setLipSeconds(s)}
                          className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${lipSeconds === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>{s}s</button>
                      ))}
                    </div>
                  </div>

                  {/* Where in the song (real API input: lipsyncStartTime) —
                      drag the highlighted window along the waveform, or click
                      elsewhere on the bar to jump it there. Width tracks the
                      Clip length buttons above (5-30s); this only moves the
                      start. No local File to hand a canvas waveform selector
                      here (the source is often a picked video's URL), so this
                      is a lighter div-based scrubber over the same peaks data
                      the Lyric timeline uses, wired to the shared seek/now clock. */}
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">
                        Song section · {fmtClock(lipStartTime)}–{fmtClock(Math.min(duration, lipStartTime + lipSeconds))}
                      </Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] text-primary"
                        disabled={!pickedVideo && !audioUrl}
                        onClick={() => { const t = Math.min(now, lipStartMax); setLipStartTime(t); seek(t); }}
                      >
                        Use playhead
                      </Button>
                    </div>
                    <div className="mt-1.5">
                      <LipWindowScrubber
                        duration={duration}
                        peaks={peaks}
                        windowStart={lipStartTime}
                        windowSeconds={lipSeconds}
                        now={now}
                        disabled={lipStartMax <= 0}
                        onChange={setLipStartTime}
                        onScrub={seek}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {lipStartMax <= 0
                        ? "Song is too short to move the window — it already covers the whole track."
                        : "Drag the amber window along the waveform, or click elsewhere on it to jump there."}
                    </p>
                  </div>

                  {/* Upcharge summary */}
                  <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-background/40 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Upcharge · {LIPSYNC_CREDITS_PER_SECOND} credits/sec</span>
                    <span className="text-sm font-semibold text-amber-500">
                      +{lipCost} credits{" "}
                      <span className="text-xs font-normal text-muted-foreground">(~${(lipCost * 0.015).toFixed(2)})</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Job cost — itemized, all margins included, updates as features toggle */}
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">This job</div>
              <div className="text-base font-bold">
                {jobCost} credits{" "}
                <span className="text-xs font-normal text-muted-foreground">(~${(jobCost * 0.015).toFixed(2)})</span>
              </div>
            </div>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Lyric alignment (sync to vocal)</span><span>{LYRIC_ALIGN_COST} cr</span>
              </div>
              {lipEnabled && (
                <div className="flex justify-between text-amber-600 dark:text-amber-500">
                  <span>Lip-sync performer · {lipSeconds}s</span><span>+{lipCost} cr</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground/70">
                <span>Video render</span><span>added at Generate</span>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              All prices include margin. You'll see the final total — including your video render — before you confirm at Generate.
            </p>
          </div>

          {/* Output */}
          <div className="rounded-xl border border-border bg-background/30 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Generated LRC (native karaoke format)</div>
              <Button variant="outline" size="sm" onClick={copyLrc} disabled={!lines.length}><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy LRC</Button>
            </div>
            <Textarea readOnly value={lrc || "// Auto-sync to generate LRC…"} className="min-h-[110px] font-mono text-xs bg-background/60" />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {pickedVideo ? (
                <Button
                  onClick={burnOnVideo}
                  disabled={(!lines.length && !(lipEnabled && faceFile)) || burning || !rightsAcknowledged}
                  className="gap-1.5"
                >
                  {burning ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {lrc ? "Burning lyrics…" : "Syncing lips…"}</>
                  ) : lrc && lipEnabled && faceFile ? (
                    <><Film className="h-4 w-4" /> Burn lyrics + lip sync onto “{pickedVideo.title}” · {jobCost} credits</>
                  ) : lrc ? (
                    <><Film className="h-4 w-4" /> Burn onto “{pickedVideo.title}” · {LYRIC_OVERLAY_COST} credits</>
                  ) : (
                    <><Smile className="h-4 w-4" /> Lip sync “{pickedVideo.title}” · {lipCost} credits</>
                  )}
                </Button>
              ) : (
                <Button onClick={stubRender} disabled={!lines.length && !(lipEnabled && faceFile)} className="gap-1.5"><Wand2 className="h-4 w-4" /> Burn onto a video…</Button>
              )}
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Info className="h-3.5 w-3.5" /> {pickedVideo ? "Renders a new video in your library — the original stays untouched." : "Pick a video (My Videos) to burn onto, or copy the LRC into Generate."}</span>
            </div>
            {lipResult && (
              <div className="mt-3 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3">
                <div className="text-xs font-semibold text-amber-500">Lip-sync result</div>
                <video src={lipResult.url} controls playsInline className="w-full max-w-xs rounded-lg border border-border bg-black" />
                <p className="text-[11px] text-muted-foreground">Saved to your library as a new video.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
