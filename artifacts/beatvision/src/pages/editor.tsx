import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  Music,
  Film,
  Image as ImageIcon,
  X,
  Loader2,
  Sparkles,
  Play,
  Pause,
} from "lucide-react";

type Kind = "video" | "photo";

interface Segment {
  id: string;
  name: string;
  kind: Kind;
  localUrl: string;
  objectPath: string | null;
  durationSec: number;
  thumb: string | null;
  uploading: boolean;
}

interface MusicTrack {
  name: string;
  objectPath: string | null;
  localUrl: string | null;
  mode: "mix" | "replace";
  volume: number;
  uploading: boolean;
}

const TRANSITIONS = [
  { value: "none", label: "None (hard cut)" },
  { value: "crossfade", label: "Crossfade" },
  { value: "fadeblack", label: "Fade to black" },
  { value: "wipe", label: "Wipe" },
  { value: "slide", label: "Slide" },
  { value: "circle", label: "Circle" },
];

function uid() {
  return Math.random().toString(36).slice(2);
}

async function presignAndUpload(file: File): Promise<string> {
  const res = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) throw new Error("Could not get upload URL");
  const { uploadURL, objectPath } = await res.json();
  const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return objectPath as string;
}

function probeVideo(url: string): Promise<{ duration: number; thumb: string | null }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    let done = false;
    const finish = (duration: number, thumb: string | null) => {
      if (done) return;
      done = true;
      v.removeAttribute("src");
      resolve({ duration, thumb });
    };
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
      } catch {
        finish(v.duration || 3, null);
      }
    };
    v.onseeked = () => {
      let thumb: string | null = null;
      try {
        const w = 200;
        const h = Math.max(1, Math.round(w * (v.videoHeight / v.videoWidth)) || 112);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.drawImage(v, 0, 0, w, h);
        thumb = c.toDataURL("image/jpeg", 0.6);
      } catch {
        /* ignore */
      }
      finish(v.duration || 3, thumb);
    };
    v.onerror = () => finish(3, null);
    v.src = url;
  });
}

export default function Editor() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [segments, setSegments] = useState<Segment[]>([]);
  const [music, setMusic] = useState<MusicTrack | null>(null);
  const [transition, setTransition] = useState("none");
  const [transitionDuration, setTransitionDuration] = useState(0.5);
  const [resolution, setResolution] = useState<"720p" | "1080p">("720p");
  const [submitting, setSubmitting] = useState(false);

  // Preview state
  const [playing, setPlaying] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [progress, setProgress] = useState(0);

  const mediaInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const dragId = useRef<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoRef = useRef<HTMLImageElement>(null);
  const transPrevRef = useRef<HTMLImageElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const segmentsRef = useRef<Segment[]>(segments);
  const idxRef = useRef(-1);
  const playingRef = useRef(false);
  const photoTimerRef = useRef<number | null>(null);
  const photoStartRef = useRef(0);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  const trialActive = !!user?.trialEndsAt && new Date(user.trialEndsAt).getTime() > Date.now();
  const trialDaysLeft = user?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(user.trialEndsAt).getTime() - Date.now()) / 86400000))
    : 0;
  const fullAccess = !!user && (user.isAdmin || user.subscriptionStatus === "active" || trialActive);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthLoading, isAuthenticated, setLocation]);

  // Handoff from Gallery / job page: pre-load a finished video as the first clip.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("editor:init");
      if (!raw) return;
      sessionStorage.removeItem("editor:init");
      const init = JSON.parse(raw);
      if (init?.video?.objectPath) {
        setSegments([
          {
            id: uid(),
            name: init.video.name || "Generated video",
            kind: "video",
            localUrl: `/api/storage${init.video.objectPath}`,
            objectPath: init.video.objectPath,
            durationSec: init.video.durationSec || 8,
            thumb: init.video.thumbPath ? `/api/storage${init.video.thumbPath}` : null,
            uploading: false,
          },
        ]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const totalDuration = segments.reduce((s, x) => s + (x.durationSec || 0), 0);
  const uploadsPending = segments.some((s) => s.uploading) || music?.uploading;

  function patchSegment(id: string, patch: Partial<Segment>) {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  // ---------- preview engine ----------
  function clearPhotoTimer() {
    if (photoTimerRef.current) {
      window.clearTimeout(photoTimerRef.current);
      photoTimerRef.current = null;
    }
  }

  function cumulativeStart(i: number) {
    const segs = segmentsRef.current;
    let t = 0;
    for (let k = 0; k < i && k < segs.length; k++) t += segs[k]!.durationSec || 0;
    return t;
  }

  function captureTransPrev() {
    const tp = transPrevRef.current;
    if (!tp) return;
    const src = videoRef.current && videoRef.current.style.display !== "none" ? videoRef.current : photoRef.current;
    if (!src) return;
    try {
      const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLImageElement).naturalWidth || 640;
      const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLImageElement).naturalHeight || 360;
      const c = document.createElement("canvas");
      c.width = sw;
      c.height = sh;
      c.getContext("2d")!.drawImage(src as CanvasImageSource, 0, 0, sw, sh);
      tp.src = c.toDataURL("image/jpeg", 0.7);
    } catch {
      /* ignore */
    }
  }

  function runTransition() {
    if (transition === "none") return;
    captureTransPrev();
    const incoming =
      videoRef.current && videoRef.current.style.display !== "none" ? videoRef.current : photoRef.current;
    const tp = transPrevRef.current;
    if (stageRef.current) stageRef.current.style.setProperty("--bvtd", `${transitionDuration}s`);
    if (tp) tp.style.display = transition === "fadeblack" ? "none" : "block";
    if (incoming) {
      const cls = `bv-anim-${transition}`;
      incoming.classList.remove(cls);
      void incoming.offsetWidth;
      incoming.classList.add(cls);
      window.setTimeout(() => {
        incoming.classList.remove(cls);
        if (tp) tp.style.display = "none";
      }, transitionDuration * 1000 + 60);
    }
  }

  function showSegment(i: number, autoplay: boolean) {
    const segs = segmentsRef.current;
    const seg = segs[i];
    if (!seg) return;
    idxRef.current = i;
    setPreviewIndex(i);
    clearPhotoTimer();
    const video = videoRef.current!;
    const photo = photoRef.current!;
    if (seg.kind === "video") {
      photo.style.display = "none";
      video.style.display = "block";
      if (video.dataset.url !== seg.localUrl) {
        video.src = seg.localUrl;
        video.dataset.url = seg.localUrl;
      }
      video.muted = !!music && music.mode === "replace";
      try {
        video.currentTime = 0;
      } catch {
        /* ignore */
      }
      if (autoplay && playingRef.current) video.play().catch(() => {});
    } else {
      video.pause();
      video.style.display = "none";
      photo.style.display = "block";
      photo.src = seg.localUrl;
      photoStartRef.current = performance.now();
      if (autoplay && playingRef.current) {
        photoTimerRef.current = window.setTimeout(() => advance(), Math.max(300, (seg.durationSec || 3) * 1000));
      }
    }
  }

  function advance() {
    const next = idxRef.current + 1;
    if (next < segmentsRef.current.length) {
      runTransition();
      showSegment(next, true);
    } else {
      pause();
    }
  }

  function play() {
    if (segmentsRef.current.length === 0) return;
    playingRef.current = true;
    setPlaying(true);
    if (idxRef.current < 0) {
      showSegment(0, true);
    } else {
      const seg = segmentsRef.current[idxRef.current];
      if (seg?.kind === "video") videoRef.current?.play().catch(() => {});
      else {
        photoStartRef.current = performance.now();
        photoTimerRef.current = window.setTimeout(() => advance(), Math.max(300, (seg?.durationSec || 3) * 1000));
      }
    }
    if (music?.localUrl && audioRef.current) {
      audioRef.current.volume = music.volume;
      audioRef.current.play().catch(() => {});
    }
  }

  function pause() {
    playingRef.current = false;
    setPlaying(false);
    videoRef.current?.pause();
    audioRef.current?.pause();
    clearPhotoTimer();
  }

  function togglePlay() {
    if (playingRef.current) pause();
    else play();
  }

  function previewBlock(i: number) {
    pause();
    showSegment(i, false);
  }

  function onVideoTimeUpdate() {
    const seg = segmentsRef.current[idxRef.current];
    if (!seg || seg.kind !== "video") return;
    const t = cumulativeStart(idxRef.current) + (videoRef.current?.currentTime || 0);
    setProgress(totalDuration ? Math.min(1, t / totalDuration) : 0);
  }

  // ---------- intake ----------
  async function addMedia(files: FileList | null) {
    if (!files) return;
    const VIDEO_EXTS = new Set(["mp4","mov","webm","mkv","avi","wmv","m4v","3gp","ts","mts","m2ts","ogv"]);
    const IMAGE_EXTS = new Set(["jpg","jpeg","png","gif","webp","bmp","heic","heif","avif","tiff","tif"]);
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isVideo = file.type.startsWith("video/") || VIDEO_EXTS.has(ext);
      const isImage = file.type.startsWith("image/") || IMAGE_EXTS.has(ext);
      if (!isVideo && !isImage) {
        toast({ title: "Unsupported file", description: `"${file.name}" is not a recognised video or image type.`, variant: "destructive" });
        continue;
      }
      const id = uid();
      const localUrl = URL.createObjectURL(file);
      const seg: Segment = {
        id,
        name: file.name,
        kind: isVideo ? "video" : "photo",
        localUrl,
        objectPath: null,
        durationSec: isImage ? 3 : 0,
        thumb: isImage ? localUrl : null,
        uploading: true,
      };
      setSegments((prev) => [...prev, seg]);
      if (isVideo) {
        probeVideo(localUrl).then(({ duration, thumb }) => patchSegment(id, { durationSec: duration || 3, thumb }));
      }
      presignAndUpload(file)
        .then((objectPath) => patchSegment(id, { objectPath, uploading: false }))
        .catch((err) => {
          patchSegment(id, { uploading: false });
          toast({ title: "Upload failed", description: String(err.message || err), variant: "destructive" });
        });
    }
  }

  async function addMusic(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    setMusic({ name: file.name, objectPath: null, localUrl, mode: "mix", volume: 0.6, uploading: true });
    try {
      const objectPath = await presignAndUpload(file);
      setMusic((m) => (m ? { ...m, objectPath, uploading: false } : m));
    } catch (err) {
      setMusic(null);
      toast({ title: "Music upload failed", description: String((err as Error).message), variant: "destructive" });
    }
  }

  function removeSegment(id: string) {
    pause();
    idxRef.current = -1;
    setPreviewIndex(-1);
    setSegments((prev) => prev.filter((s) => s.id !== id));
  }

  function onDrop(overId: string) {
    const from = segments.findIndex((s) => s.id === dragId.current);
    const to = segments.findIndex((s) => s.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    setSegments((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }

  async function exportVideo() {
    const ready = segments.filter((s) => s.objectPath);
    if (ready.length === 0) {
      toast({ title: "Add some clips first", variant: "destructive" });
      return;
    }
    pause();
    setSubmitting(true);
    try {
      const body = {
        name: "Editor export",
        segments: ready.map((s) => ({
          objectPath: s.objectPath,
          kind: s.kind,
          durationSec: Math.max(0.5, s.durationSec || 3),
        })),
        music: music?.objectPath ? { objectPath: music.objectPath, mode: music.mode, volume: music.volume } : undefined,
        transition: transition === "none" ? undefined : { type: transition, durationSec: transitionDuration },
        resolution,
      };
      const res = await fetch("/api/studio/render", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 402 || res.status === 403) {
        const e = await res.json();
        toast({ title: "Can't export yet", description: e.error, variant: "destructive" });
        if (e.code === "INSUFFICIENT_CREDITS" || e.code === "UPGRADE_REQUIRED" || e.code === "TRIAL_ENDED") setLocation("/pricing");
        return;
      }
      if (!res.ok) throw new Error(`Render request failed (${res.status})`);
      const { job } = await res.json();
      setLocation(`/jobs/${job.id}`);
    } catch (err) {
      toast({ title: "Export failed", description: String((err as Error).message), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <style>{`
        @keyframes bvTrIn{from{opacity:0}to{opacity:1}}
        @keyframes bvTrSlide{from{transform:translateX(100%)}to{transform:translateX(0)}}
        @keyframes bvTrWipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
        @keyframes bvTrCircle{from{clip-path:circle(0% at 50% 50%)}to{clip-path:circle(75% at 50% 50%)}}
        .bv-anim-crossfade,.bv-anim-fadeblack{animation:bvTrIn var(--bvtd,.5s) ease both}
        .bv-anim-slide{animation:bvTrSlide var(--bvtd,.5s) ease both}
        .bv-anim-wipe{animation:bvTrWipe var(--bvtd,.5s) ease both}
        .bv-anim-circle{animation:bvTrCircle var(--bvtd,.5s) ease both}
      `}</style>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Editor</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Arrange your clips and photos, add music and transitions, preview, then export an MP4.
        </p>
      </div>

      {trialActive && (
        <Card className="border-primary/30 bg-primary/5 mb-6 p-4 text-sm">
          Free trial — {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left. The full Editor is unlocked: 1080p,
          no watermark, all transitions.{" "}
          <button className="text-primary font-medium underline" onClick={() => setLocation("/pricing")}>
            Subscribe
          </button>{" "}
          to keep it after your trial.
        </Card>
      )}
      {!fullAccess && (
        <Card className="border-primary/30 bg-primary/5 mb-6 p-4 text-sm">
          Your free trial has ended.{" "}
          <button className="text-primary font-medium underline" onClick={() => setLocation("/pricing")}>
            Subscribe
          </button>{" "}
          for unlimited editing — or each export costs credits.
        </Card>
      )}

      {/* Preview */}
      <div
        ref={stageRef}
        className="border-border relative mb-3 aspect-video w-full overflow-hidden rounded-lg border bg-black"
      >
        <img ref={transPrevRef} alt="" className="absolute inset-0 h-full w-full object-contain" style={{ display: "none", zIndex: 1 }} />
        <video
          ref={videoRef}
          playsInline
          onEnded={() => playingRef.current && advance()}
          onTimeUpdate={onVideoTimeUpdate}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ zIndex: 2 }}
        />
        <img ref={photoRef} alt="" className="absolute inset-0 h-full w-full object-contain" style={{ display: "none", zIndex: 2 }} />
        {segments.length === 0 && (
          <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
            Add media to preview your video
          </div>
        )}
        {segments.length > 0 && (
          <button onClick={togglePlay} className="absolute inset-0 z-10 flex items-center justify-center" aria-label="Play/Pause">
            {!playing && (
              <span className="bg-primary/90 flex h-16 w-16 items-center justify-center rounded-full shadow-2xl">
                <Play className="ml-1 h-7 w-7 text-white" />
              </span>
            )}
          </button>
        )}
      </div>
      {music?.localUrl && <audio ref={audioRef} src={music.localUrl} />}

      {/* Transport */}
      {segments.length > 0 && (
        <div className="mb-6 flex items-center gap-3">
          <Button size="icon" variant="outline" onClick={togglePlay} className="h-9 w-9 shrink-0">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded">
            <div className="bg-primary h-full rounded" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="text-muted-foreground w-14 text-right text-xs tabular-nums">{totalDuration.toFixed(1)}s</span>
        </div>
      )}

      {/* Add media */}
      <div className="mb-4 flex flex-wrap gap-3">
        <input ref={mediaInputRef} type="file" accept="video/*,image/*,.mp4,.mov,.webm,.mkv,.avi,.wmv,.m4v,.3gp,.ts,.ogv" multiple hidden onChange={(e) => addMedia(e.target.files)} />
        <Button onClick={() => mediaInputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> Add media
        </Button>
        <input ref={musicInputRef} type="file" accept="audio/*" hidden onChange={(e) => addMusic(e.target.files)} />
        <Button variant="outline" onClick={() => musicInputRef.current?.click()}>
          <Music className="mr-2 h-4 w-4" /> {music ? "Change music" : "Add music"}
        </Button>
      </div>

      {/* Timeline */}
      <Card className="mb-6 p-4">
        <div className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
          Timeline {segments.length > 0 && `· ${totalDuration.toFixed(1)}s`}
        </div>
        {segments.length === 0 ? (
          <div className="text-muted-foreground flex h-24 items-center justify-center text-sm">
            Add videos and photos to build your timeline.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {segments.map((seg, i) => (
              <div
                key={seg.id}
                draggable
                onDragStart={() => (dragId.current = seg.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  onDrop(seg.id);
                }}
                onClick={() => previewBlock(i)}
                className={`relative h-[58px] w-[92px] cursor-pointer overflow-hidden rounded-md border bg-background ${
                  previewIndex === i ? "border-primary" : "border-border"
                }`}
                title={seg.name}
              >
                {seg.thumb ? (
                  <img src={seg.thumb} alt="" className="h-full w-full object-contain" />
                ) : (
                  <div className="text-muted-foreground flex h-full w-full items-center justify-center">
                    {seg.kind === "video" ? <Film className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                  </div>
                )}
                {seg.uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </div>
                )}
                <button
                  className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSegment(seg.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
                {seg.kind === "photo" ? (
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={seg.durationSec}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchSegment(seg.id, { durationSec: Math.max(0.5, Number(e.target.value) || 3) })}
                    className="border-border absolute bottom-1 right-1 w-10 rounded border bg-black/70 px-1 py-0.5 text-right text-[10px] text-white"
                  />
                ) : (
                  <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
                    {(seg.durationSec || 0).toFixed(1)}s
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground mt-3 text-xs">
          Drag blocks to reorder · click to preview · set a photo's seconds in its box
        </p>
      </Card>

      {/* Controls */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 text-sm font-medium">Transition</div>
          <Select value={transition} onValueChange={setTransition}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSITIONS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {transition !== "none" && (
            <div className="mt-4">
              <div className="text-muted-foreground mb-2 text-xs">Length · {transitionDuration.toFixed(1)}s</div>
              <Slider min={0.2} max={2} step={0.1} value={[transitionDuration]} onValueChange={(v) => setTransitionDuration(v[0]!)} />
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 text-sm font-medium">Music</div>
          {music ? (
            <>
              <div className="mb-3 truncate text-sm">{music.name}</div>
              <div className="grid grid-cols-2 gap-3">
                <Select value={music.mode} onValueChange={(v) => setMusic((m) => (m ? { ...m, mode: v as "mix" | "replace" } : m))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mix">Mix with clip audio</SelectItem>
                    <SelectItem value="replace">Replace clip audio</SelectItem>
                  </SelectContent>
                </Select>
                <div>
                  <div className="text-muted-foreground mb-1 text-xs">Volume</div>
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={[music.volume]}
                    onValueChange={(v) => {
                      const vol = v[0]!;
                      setMusic((m) => (m ? { ...m, volume: vol } : m));
                      if (audioRef.current) audioRef.current.volume = vol;
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">No track. Add one to score your video.</p>
          )}
          <div className="mt-4">
            <div className="mb-2 text-sm font-medium">Resolution</div>
            <Select value={resolution} onValueChange={(v) => setResolution(v as "720p" | "1080p")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>
      </div>

      {/* Export */}
      <div className="flex items-center gap-3">
        <Button size="lg" onClick={exportVideo} disabled={submitting || !!uploadsPending || segments.length === 0}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Export &amp; render MP4
        </Button>
        {uploadsPending && <span className="text-muted-foreground text-sm">Uploading…</span>}
      </div>
    </div>
  );
}
