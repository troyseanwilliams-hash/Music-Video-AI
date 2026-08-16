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
  Mic2, Music2, Wand2, Play, Pause, Upload, Smile, Copy, Type, Clock,
  ChevronLeft, ChevronRight, Info,
} from "lucide-react";

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

// One switch to promote this out of admin-only later. Kept false = admin-only.
const LYRICSYNC_PUBLIC = false;

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

export default function LyricSyncStudio() {
  const { toast } = useToast();

  // ── Source audio ──
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [duration, setDuration] = useState(FALLBACK_DURATION);
  const [peaks, setPeaks] = useState<number[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioFileRef = useRef<HTMLInputElement | null>(null);

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
  const [mode, setMode] = useState<"lyric" | "lip">("lyric");
  const [preset, setPreset] = useState<Preset>("karaoke");
  const [position, setPosition] = useState<Position>("center");
  const [color, setColor] = useState(COLORS[0].key);
  const [size, setSize] = useState(30);

  // ── Lip sync ──
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const [lipStrength, setLipStrength] = useState(80);
  const [placement, setPlacement] = useState<"full" | "scene">("full");
  const faceInputRef = useRef<HTMLInputElement | null>(null);

  const lrc = useMemo(() => toLrc(lines), [lines]);

  // Load audio file → object URL + duration + waveform peaks.
  const onAudioFile = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setAudioName(file.name);
    setSynced(false);
    setLines([]);
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

  // Auto-sync
  const runSync = useCallback(() => {
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
    toast({ title: "Synced", description: `${result.length} lines aligned to ${fmtClock(d)}. Nudge any line to fine-tune.` });
  }, [lyrics, duration, toast]);

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
      if (audioRef.current && audioUrl) {
        t = audioRef.current.currentTime;
      } else {
        simClock.current = Math.min(duration, simClock.current + dt);
        t = simClock.current;
      }
      setNow(t);
      if (t >= duration - 0.05 && !audioUrl) { setPlaying(false); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, audioUrl, duration]);

  const togglePlay = useCallback(() => {
    if (!synced) runSync();
    if (audioRef.current && audioUrl) {
      if (playing) audioRef.current.pause();
      else audioRef.current.play().catch(() => {});
    } else if (!playing) {
      if (simClock.current >= duration - 0.05) simClock.current = 0;
    }
    setPlaying((p) => !p);
  }, [synced, runSync, playing, audioUrl, duration]);

  const seek = useCallback((t: number) => {
    t = Math.max(0, Math.min(duration, t));
    if (audioRef.current && audioUrl) audioRef.current.currentTime = t;
    simClock.current = t;
    setNow(t);
  }, [duration, audioUrl]);

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

  const stubRender = () => {
    toast({
      title: "POC — render is stubbed",
      description: "Wiring: submit lyricsText (LRC) + face + style to the Generate job pipeline. Alignment & lip-sync run server-side at render.",
    });
  };

  return (
    <div className="space-y-4">
      {/* Internal banner */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
        <p className="text-sm">
          <span className="font-semibold">Internal build · Admin only.</span>{" "}
          <span className="text-muted-foreground">
            AILyricSync is not public — it lives behind the <code className="text-xs bg-muted/40 px-1 rounded">/admin</code> gate.
            Flip <code className="text-xs bg-muted/40 px-1 rounded">LYRICSYNC_PUBLIC</code> to promote it. Currently{" "}
            <span className={LYRICSYNC_PUBLIC ? "text-emerald-500" : "text-amber-500"}>{LYRICSYNC_PUBLIC ? "PUBLIC" : "ADMIN-ONLY"}</span>.
          </span>
        </p>
      </div>

      <Card className="bg-card/50 border-card-border overflow-hidden">
        <div className="h-1 w-full bg-gradient-electric" />
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mic2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg leading-tight">Lyric + Lip Sync Studio</CardTitle>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant="outline" className="text-[10px]">Beta · Admin</Badge>
                <span className="text-[10px] text-muted-foreground">AILyricSync</span>
              </div>
            </div>
          </div>
          <CardDescription className="mt-2">
            Sync words to the vocal and (optionally) drive a lip-synced performer. Outputs the app's native LRC karaoke
            format, ready for the Generate pipeline.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Mode selector */}
          <div className="inline-flex gap-1 rounded-lg border border-border bg-background/40 p-1">
            <button
              onClick={() => setMode("lyric")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === "lyric" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >Lyric Sync</button>
            <button
              onClick={() => setMode("lip")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === "lip" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >Lyric + Lip Sync</button>
          </div>

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
                    <div className="text-xs text-muted-foreground">{audioName ? `${fmtClock(duration)} · ready` : "Upload an audio file to sync against"}</div>
                  </div>
                  <Button variant="outline" size="sm" className="ml-auto" onClick={() => audioFileRef.current?.click()}>
                    <Upload className="mr-1.5 h-3.5 w-3.5" /> {audioName ? "Change" : "Upload"}
                  </Button>
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
                  onChange={(e) => { setLyrics(e.target.value); setSynced(false); }}
                  className="min-h-[150px] resize-none bg-background/50"
                  maxLength={5000}
                  placeholder="Paste plain lyrics — one line each. Section tags like [Chorus] are ignored for timing."
                />
                <div className="flex items-center gap-2 mt-2">
                  <Button onClick={runSync} className="gap-1.5"><Wand2 className="h-4 w-4" /> Auto-sync timing</Button>
                  <span className="text-xs text-muted-foreground">{synced ? `${lines.length} lines synced` : "not synced yet"}</span>
                </div>
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
                  {mode === "lip" && (
                    <svg viewBox="0 0 120 130" className="absolute top-[16%] left-1/2 -translate-x-1/2 w-28 opacity-95">
                      <ellipse cx="60" cy="60" rx="42" ry="48" fill="#e9c9a8" />
                      <circle cx="45" cy="52" r="5" fill="#26202a" /><circle cx="75" cy="52" r="5" fill="#26202a" />
                      <path d="M30 30 Q60 6 90 30 L86 40 Q60 24 34 40 Z" fill="#2a2230" />
                      <ellipse cx="60" cy="86"
                        rx="14"
                        ry={playing ? 4 + Math.abs(Math.sin(now * 14)) * (10 * (lipStrength / 100)) : 4}
                        fill="#7a2b2b" />
                    </svg>
                  )}
                  <div className="absolute top-2 right-3 text-[10px] text-white/50">AIBeatSync</div>
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

              {/* Lip sync config */}
              {mode === "lip" && (
                <div className="rounded-xl border border-border bg-background/30 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Smile className="h-4 w-4 text-primary" /> Lip-sync performer
                  </div>
                  <input ref={faceInputRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setFacePreview(URL.createObjectURL(f)); e.target.value = ""; }} />
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={() => faceInputRef.current?.click()}>
                      <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload face
                    </Button>
                    {facePreview && <img src={facePreview} alt="face" className="h-12 w-12 rounded-md border border-border object-cover" />}
                    <span className="text-[11px] text-muted-foreground">Renders via OmniHuman at export (~16 cr/s).</span>
                  </div>
                  <div className="flex gap-1.5">
                    {(["full", "scene"] as const).map((p) => (
                      <button key={p} onClick={() => setPlacement(p)}
                        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${placement === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                        {p === "full" ? "Full-frame singer" : "Performer in scene"}</button>
                    ))}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Lip-sync strength · {lipStrength}%</Label>
                    <Slider className="mt-2" value={[lipStrength]} min={0} max={100} step={5} onValueChange={([v]) => setLipStrength(v)} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Output */}
          <div className="rounded-xl border border-border bg-background/30 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Generated LRC (native karaoke format)</div>
              <Button variant="outline" size="sm" onClick={copyLrc} disabled={!lines.length}><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy LRC</Button>
            </div>
            <Textarea readOnly value={lrc || "// Auto-sync to generate LRC…"} className="min-h-[110px] font-mono text-xs bg-background/60" />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button onClick={stubRender} disabled={!lines.length} className="gap-1.5"><Wand2 className="h-4 w-4" /> Send to render (POC)</Button>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Info className="h-3.5 w-3.5" /> Copy LRC → Generate → “Lyric video · karaoke captions” works end-to-end today.</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
