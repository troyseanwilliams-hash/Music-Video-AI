import { useRef, useState } from "react";
import { getListVideosQueryKey, useListVideos } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowDown, ArrowUp, ChevronDown, Film, Layers, Loader2, PanelRight, PanelLeft, RectangleVertical,
  Trash2, Type, Upload, Clock,
} from "lucide-react";
import {
  clamp, LAYOUT_PRESETS, type LayerIssue, MAX_OVERLAYS, MAX_TEXT_CARDS, MAX_TEXT_LENGTH, MAX_TIMELINE_SEC, overlayId,
  type TextCard, type VideoOverlay,
} from "./overlayTypes";

export interface OverlaySourceClip {
  name: string;
  objectPath: string;
  durationSec: number;
}

// Reads a local file's duration before upload. Rejects on decode errors or a
// 15s timeout instead of guessing, and always revokes the object URL.
async function probeFileDuration(file: File, timeoutMs = 15_000): Promise<number> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  let timer = 0;
  try {
    return await new Promise<number>((resolve, reject) => {
      timer = window.setTimeout(() => reject(new Error("Timed out reading this video. Try a different file.")), timeoutMs);
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => {
        if (Number.isFinite(v.duration) && v.duration > 0) resolve(v.duration);
        else reject(new Error("Couldn't read this video's length. Try exporting it as MP4."));
      };
      v.onerror = () => reject(new Error("This video can't be decoded in your browser. Try an MP4 (H.264) file."));
      v.src = url;
    });
  } finally {
    window.clearTimeout(timer);
    v.onloadedmetadata = null;
    v.onerror = null;
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

function NumField({
  label, value, onChange, min, max, step = 0.1, suffix, testId,
}: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string; testId: string;
}) {
  return (
    <label className="block text-[11px] font-medium text-muted-foreground">
      {label}
      <div className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(3))}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) onChange(clamp(n, min, max));
          }}
          className="w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-sm text-foreground tabular-nums"
          data-testid={testId}
        />
        {suffix && <span className="shrink-0 text-[11px]">{suffix}</span>}
      </div>
    </label>
  );
}

const pct = (v: number) => Math.round(v * 1000) / 10;

export function OverlayPanel({
  overlays, textCards, setOverlays, setTextCards, selectedId, setSelectedId,
  playheadSec, totalDuration, projectClips, uploadFile, issues,
}: {
  overlays: VideoOverlay[];
  textCards: TextCard[];
  setOverlays: (fn: (prev: VideoOverlay[]) => VideoOverlay[]) => void;
  setTextCards: (fn: (prev: TextCard[]) => TextCard[]) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  playheadSec: number;
  totalDuration: number;
  projectClips: OverlaySourceClip[];
  uploadFile: (file: File) => Promise<string>;
  issues: LayerIssue[];
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(overlays.length > 0 || textCards.length > 0);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceDur, setSourceDur] = useState<Record<string, number>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const isOpen = open || overlays.length > 0 || textCards.length > 0;

  const library = useListVideos(
    { limit: 50 },
    { query: { queryKey: getListVideosQueryKey({ limit: 50 }), enabled: pickerOpen } },
  );

  const timelineEnd = Math.max(1, Math.min(MAX_TIMELINE_SEC, totalDuration || MAX_TIMELINE_SEC));
  const start = clamp(playheadSec, 0, Math.max(0, timelineEnd - 0.3));

  function addOverlay(clip: OverlaySourceClip) {
    if (overlays.length >= MAX_OVERLAYS) {
      toast({ title: "Overlay limit reached", description: `A project can hold up to ${MAX_OVERLAYS} overlay clips.`, variant: "destructive" });
      return;
    }
    const id = overlayId();
    const dur = clamp(Math.min(clip.durationSec || 5, timelineEnd - start), 0.3, MAX_TIMELINE_SEC);
    const o: VideoOverlay = {
      id, name: clip.name, objectPath: clip.objectPath, startSec: start, durationSec: dur, trimStart: 0,
      ...LAYOUT_PRESETS.reactionRight, volume: 0.25, borderWidth: 0, borderColor: "#ffffff",
    };
    setSourceDur((m) => ({ ...m, [id]: clip.durationSec }));
    setOverlays((prev) => [...prev, o]);
    setSelectedId(id);
    setOpen(true);
  }

  async function onUpload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast({ title: "Choose a video file", description: "Overlays accept video clips only.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const duration = await probeFileDuration(file);
      const objectPath = await uploadFile(file);
      addOverlay({ name: file.name, objectPath, durationSec: duration });
    } catch (err) {
      toast({ title: "Overlay upload failed", description: String((err as Error).message), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function addText() {
    if (textCards.length >= MAX_TEXT_CARDS) {
      toast({ title: "Text card limit reached", description: `A project can hold up to ${MAX_TEXT_CARDS} text cards.`, variant: "destructive" });
      return;
    }
    const id = overlayId();
    setTextCards((prev) => [...prev, {
      id, text: "Your text here", startSec: start, durationSec: clamp(Math.min(4, timelineEnd - start), 0.3, MAX_TIMELINE_SEC),
      x: 0.05, y: 0.75, fontSize: 0.06, color: "#ffffff", backgroundColor: "#111111",
    }]);
    setSelectedId(id);
    setOpen(true);
  }

  const patchO = (id: string, patch: Partial<VideoOverlay>) => setOverlays((p) => p.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const patchT = (id: string, patch: Partial<TextCard>) => setTextCards((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const moveO = (id: string, dir: -1 | 1) => setOverlays((p) => {
    const i = p.findIndex((o) => o.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.length) return p;
    const next = [...p];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });

  const selO = overlays.find((o) => o.id === selectedId) ?? null;
  const selT = textCards.find((t) => t.id === selectedId) ?? null;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

  return (
    <section className="mb-6 rounded-lg border border-border bg-card" data-testid="overlay-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={isOpen}
        data-testid="button-toggle-overlays"
      >
        <span className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Overlays &amp; text cards</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Optional</span>
          {(overlays.length > 0 || textCards.length > 0) && (
            <span className="text-xs text-muted-foreground">{overlays.length} clip{overlays.length === 1 ? "" : "s"}, {textCards.length} text</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <p className="mb-3 text-xs text-muted-foreground">
            Play a clip on top of your main video for commentary or reactions, or add a title card. New items start at the playhead ({fmt(start)}). Your main video's sound is never changed.
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => onUpload(e.target.files)} data-testid="input-overlay-file" />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="button-overlay-upload">
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload overlay clip"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} data-testid="button-overlay-pick">
              <Film className="mr-2 h-4 w-4 text-primary" /> Use existing clip
            </Button>
            <Button size="sm" variant="outline" onClick={addText} data-testid="button-add-textcard">
              <Type className="mr-2 h-4 w-4 text-primary" /> Add text card
            </Button>
          </div>

          {issues.length > 0 && (
            <div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="status-layer-issues">
              <div className="mb-1 font-semibold">Fix these before saving or exporting:</div>
              <ul className="list-disc space-y-0.5 pl-4">
                {issues.slice(0, 8).map((issue, i) => (
                  <li key={i}>
                    {issue.id ? (
                      <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setSelectedId(issue.id)}>{issue.message}</button>
                    ) : issue.message}
                  </li>
                ))}
                {issues.length > 8 && <li>and {issues.length - 8} more</li>}
              </ul>
            </div>
          )}

          {overlays.length + textCards.length > 0 && (
            <ul className="mb-4 space-y-1.5">
              {overlays.map((o, i) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(o.id)}
                    className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${selectedId === o.id ? "border-primary bg-primary/[0.06]" : "border-border hover:bg-muted/50"}`}
                    data-testid={`row-overlay-${o.id}`}
                  >
                    <Film className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    {issues.some((x) => x.id === o.id) && <span className="shrink-0 text-[11px] font-medium text-destructive">Fix timing</span>}
                    <span className="shrink-0 text-[11px] capitalize text-muted-foreground">{o.layout} · layer {i + 1}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmt(o.startSec)}–{fmt(o.startSec + o.durationSec)}</span>
                  </button>
                </li>
              ))}
              {textCards.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${selectedId === t.id ? "border-primary bg-primary/[0.06]" : "border-border hover:bg-muted/50"}`}
                    data-testid={`row-textcard-${t.id}`}
                  >
                    <Type className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{t.text || "Empty text card"}</span>
                    {issues.some((x) => x.id === t.id) && <span className="shrink-0 text-[11px] font-medium text-destructive">Fix timing</span>}
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmt(t.startSec)}–{fmt(t.startSec + t.durationSec)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selO && (() => {
            const maxTrim = Math.max(0, (sourceDur[selO.id] ?? MAX_TIMELINE_SEC) - 0.3);
            const ends = selO.startSec + selO.durationSec;
            return (
              <div className="space-y-4 rounded-lg border border-primary/25 bg-primary/[0.04] p-3" data-testid="editor-overlay-selected">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{selO.name}</span>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Move layer down" onClick={() => moveO(selO.id, -1)} data-testid="button-overlay-down"><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Move layer up" onClick={() => moveO(selO.id, 1)} data-testid="button-overlay-up"><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Delete overlay" onClick={() => { setOverlays((p) => p.filter((o) => o.id !== selO.id)); setSelectedId(null); }} data-testid="button-overlay-delete"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Layout</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={selO.layout === "reaction" && selO.x > 0.5 ? "default" : "outline"} onClick={() => patchO(selO.id, LAYOUT_PRESETS.reactionRight)} data-testid="button-layout-reaction-right"><PanelRight className="mr-1.5 h-4 w-4" />Reaction right</Button>
                    <Button size="sm" variant={selO.layout === "reaction" && selO.x <= 0.5 ? "default" : "outline"} onClick={() => patchO(selO.id, LAYOUT_PRESETS.reactionLeft)} data-testid="button-layout-reaction-left"><PanelLeft className="mr-1.5 h-4 w-4" />Reaction left</Button>
                    <Button size="sm" variant={selO.layout === "commentary" ? "default" : "outline"} onClick={() => patchO(selO.id, LAYOUT_PRESETS.commentary)} data-testid="button-layout-commentary"><RectangleVertical className="mr-1.5 h-4 w-4" />Commentary</Button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {selO.layout === "commentary"
                      ? "Clip sits full-height in the centre with a blurred copy filling the sides."
                      : "Drag the clip in the preview to move it; drag the corner handle to resize."}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <NumField label="Starts at" suffix="s" value={selO.startSec} min={0} max={Math.max(0, MAX_TIMELINE_SEC - 0.3)} onChange={(v) => patchO(selO.id, { startSec: v })} testId="input-overlay-start" />
                  <NumField label="Duration" suffix="s" value={selO.durationSec} min={0.3} max={MAX_TIMELINE_SEC} onChange={(v) => patchO(selO.id, { durationSec: v })} testId="input-overlay-duration" />
                  <NumField label="Skip into clip" suffix="s" value={selO.trimStart} min={0} max={maxTrim} onChange={(v) => patchO(selO.id, { trimStart: v })} testId="input-overlay-trim" />
                  <div className="flex items-end">
                    <Button size="sm" variant="outline" className="w-full" onClick={() => patchO(selO.id, { startSec: start })} data-testid="button-overlay-at-playhead"><Clock className="mr-1.5 h-3.5 w-3.5" />At playhead</Button>
                  </div>
                </div>
                {ends > totalDuration + 0.05 && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-destructive">
                    <span>Ends at {fmt(ends)}, after the main video ({fmt(totalDuration)}).</span>
                    {totalDuration - selO.startSec >= 0.3 && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => patchO(selO.id, { durationSec: Math.floor((totalDuration - selO.startSec) * 100) / 100 })} data-testid="button-overlay-fit-end">End with main video</Button>
                    )}
                  </div>
                )}
                {sourceDur[selO.id] === undefined ? (
                  <p className="text-[11px] text-muted-foreground">Clip length isn't known in this session. If skip + duration is longer than the clip, the export checks it against the real file and may hold the last frame or reject it.</p>
                ) : selO.trimStart + selO.durationSec > sourceDur[selO.id]! + 0.05 ? (
                  <p className="text-[11px] text-amber-600">Skip + duration ({(selO.trimStart + selO.durationSec).toFixed(1)}s) is longer than this clip ({sourceDur[selO.id]!.toFixed(1)}s).</p>
                ) : null}

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>Overlay sound</span><span className="tabular-nums">{Math.round(selO.volume * 100)}%</span>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {([["Mute", 0], ["Low", 0.25], ["Full", 1]] as const).map(([label, v]) => (
                      <Button key={label} size="sm" variant={Math.abs(selO.volume - v) < 0.001 ? "default" : "outline"} onClick={() => patchO(selO.id, { volume: v })} data-testid={`button-overlay-volume-${label.toLowerCase()}`}>{label}</Button>
                    ))}
                  </div>
                  <Slider min={0} max={1} step={0.05} value={[selO.volume]} onValueChange={([v]) => patchO(selO.id, { volume: v ?? 0 })} aria-label="Overlay volume" />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {selO.layout === "commentary" ? (
                    <p className="col-span-full text-[11px] text-muted-foreground">Commentary always fills the frame. Pick a Reaction layout to move or resize this clip.</p>
                  ) : (<>
                  <NumField label="Left" suffix="%" value={pct(selO.x)} min={0} max={pct(1 - selO.width)} step={1} onChange={(v) => patchO(selO.id, { x: v / 100, layout: "custom" })} testId="input-overlay-x" />
                  <NumField label="Top" suffix="%" value={pct(selO.y)} min={0} max={pct(1 - selO.height)} step={1} onChange={(v) => patchO(selO.id, { y: v / 100, layout: "custom" })} testId="input-overlay-y" />
                  <NumField label="Size" suffix="% wide" value={pct(selO.width)} min={5} max={100} step={1} onChange={(v) => {
                    const s = v / 100 / selO.width;
                    const w = Math.min(selO.width * s, 1, (selO.height * s > 1 ? selO.width / selO.height : Infinity));
                    const h = selO.height * (w / selO.width);
                    patchO(selO.id, { width: w, height: h, x: clamp(selO.x, 0, 1 - w), y: clamp(selO.y, 0, 1 - h), layout: "custom" });
                  }} testId="input-overlay-size" />
                  </>)}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Corner rounding</div>
                    <Slider min={0} max={0.25} step={0.005} value={[selO.cornerRadius]} onValueChange={([v]) => patchO(selO.id, { cornerRadius: v ?? 0 })} aria-label="Corner radius" />
                  </div>
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Border</div>
                    <Slider min={0} max={0.02} step={0.001} value={[selO.borderWidth]} onValueChange={([v]) => patchO(selO.id, { borderWidth: v ?? 0 })} aria-label="Border width" />
                  </div>
                  <label className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                    Border colour
                    <input type="color" value={selO.borderColor} onChange={(e) => patchO(selO.id, { borderColor: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent" data-testid="input-overlay-border-color" />
                  </label>
                </div>
              </div>
            );
          })()}

          {selT && (
            <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/[0.04] p-3" data-testid="editor-textcard-selected">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Text card</span>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Delete text card" onClick={() => { setTextCards((p) => p.filter((t) => t.id !== selT.id)); setSelectedId(null); }} data-testid="button-textcard-delete"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div>
                <Textarea value={selT.text} maxLength={MAX_TEXT_LENGTH} rows={2} onChange={(e) => patchT(selT.id, { text: e.target.value.slice(0, MAX_TEXT_LENGTH) })} aria-label="Text card text" data-testid="input-textcard-text" />
                <div className="mt-1 flex justify-between gap-2 text-[10px] text-muted-foreground"><span>Lines break only where you press Enter — long lines are not wrapped.</span><span>{selT.text.length}/{MAX_TEXT_LENGTH}</span></div>
                {selT.startSec + selT.durationSec > totalDuration + 0.05 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-destructive">
                    <span>Ends after the main video ({fmt(totalDuration)}).</span>
                    {totalDuration - selT.startSec >= 0.3 && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => patchT(selT.id, { durationSec: Math.floor((totalDuration - selT.startSec) * 100) / 100 })}>End with main video</Button>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <NumField label="Starts at" suffix="s" value={selT.startSec} min={0} max={MAX_TIMELINE_SEC - 0.3} onChange={(v) => patchT(selT.id, { startSec: v })} testId="input-textcard-start" />
                <NumField label="Duration" suffix="s" value={selT.durationSec} min={0.3} max={MAX_TIMELINE_SEC} onChange={(v) => patchT(selT.id, { durationSec: v })} testId="input-textcard-duration" />
                <NumField label="Left" suffix="%" value={pct(selT.x)} min={0} max={98} step={1} onChange={(v) => patchT(selT.id, { x: v / 100 })} testId="input-textcard-x" />
                <NumField label="Top" suffix="%" value={pct(selT.y)} min={0} max={98} step={1} onChange={(v) => patchT(selT.id, { y: v / 100 })} testId="input-textcard-y" />
                <NumField label="Size" suffix="%" value={pct(selT.fontSize)} min={1} max={15} step={0.5} onChange={(v) => patchT(selT.id, { fontSize: v / 100 })} testId="input-textcard-size" />
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[11px] font-medium text-muted-foreground">
                <label className="flex items-center gap-2">Text <input type="color" value={selT.color} onChange={(e) => patchT(selT.id, { color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent" data-testid="input-textcard-color" /></label>
                <label className="flex items-center gap-2">Background <input type="color" value={selT.backgroundColor} onChange={(e) => patchT(selT.id, { backgroundColor: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent" data-testid="input-textcard-bg" /></label>
                <Button size="sm" variant="outline" onClick={() => patchT(selT.id, { startSec: start })}><Clock className="mr-1.5 h-3.5 w-3.5" />At playhead</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Use an existing clip as an overlay</DialogTitle>
            <DialogDescription>Pick a video already in this project or from your Gallery.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-semibold text-muted-foreground">In this project</div>
              {projectClips.length === 0 ? (
                <p className="text-xs text-muted-foreground">No uploaded video clips on the timeline yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {projectClips.map((c, i) => (
                    <li key={`${c.objectPath}-${i}`}>
                      <button type="button" className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted/50" onClick={() => { addOverlay(c); setPickerOpen(false); }} data-testid={`button-pick-project-clip-${i}`}>
                        <Film className="h-3.5 w-3.5 text-primary" /><span className="flex-1 truncate">{c.name}</span>
                        <span className="text-[11px] text-muted-foreground">{c.durationSec.toFixed(1)}s</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-muted-foreground">From Gallery</div>
              {library.isLoading ? (
                <div className="space-y-1.5">{[0, 1, 2].map((k) => <div key={k} className="h-9 animate-pulse rounded-md bg-muted" />)}</div>
              ) : library.isError ? (
                <div className="flex items-center gap-2 text-xs text-destructive">Couldn't load your Gallery. <Button size="sm" variant="outline" onClick={() => library.refetch()}>Retry</Button></div>
              ) : (library.data?.videos ?? []).filter((v) => v.videoObjectPath).length === 0 ? (
                <p className="text-xs text-muted-foreground">No finished Gallery videos yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(library.data?.videos ?? []).filter((v) => v.videoObjectPath).map((v) => (
                    <li key={v.id}>
                      <button type="button" className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted/50" onClick={() => {
                        addOverlay({ name: v.title?.trim() || "Gallery video", objectPath: v.videoObjectPath!, durationSec: typeof v.durationSeconds === "number" && v.durationSeconds > 0 ? v.durationSeconds : 8 });
                        setPickerOpen(false);
                      }} data-testid={`button-pick-gallery-${v.id}`}>
                        <Film className="h-3.5 w-3.5 text-primary" /><span className="flex-1 truncate">{v.title?.trim() || "Gallery video"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPickerOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
