import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useLocation, Link } from "wouter";
import SignupTeaser from "@/components/SignupTeaser";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { SoundtrackPickerDialog } from "@/components/SoundtrackPickerDialog";
import TopUpRequiredDialog from "@/components/TopUpRequiredDialog";
import { TutorialTip } from "@/components/TutorialTip";
import { useGetDashboardStats } from "@workspace/api-client-react";
import { canAffordCredits, LYRIC_ALIGN_COST } from "@/lib/creditPricing";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SAMPLE_LYRICS } from "@/lib/sampleLyrics";
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
  Mic2,
  Info,
  Link2,
  Scissors,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  trimStart?: number; // seconds trimmed off the front (video only)
  trimEnd?: number; // seconds trimmed off the back (video only)
}

interface MusicTrack {
  name: string;
  objectPath: string | null;
  localUrl: string | null;
  mode: "mix" | "replace";
  volume: number;
  uploading: boolean;
  loop?: boolean; // repeat the track to fill the video (undefined = true)
  fade?: boolean; // fade in at the start, out at the end (undefined = false)
}

const TRANSITIONS = [
  { value: "none", label: "None (hard cut)" },
  { value: "crossfade", label: "Crossfade" },
  { value: "fadeblack", label: "Fade through black" },
  { value: "fadewhite", label: "Fade through white" },
  { value: "dissolve", label: "Dissolve" },
  { value: "pixelize", label: "Pixelize" },
  { value: "wipeleft", label: "Wipe left" },
  { value: "wiperight", label: "Wipe right" },
  { value: "wipeup", label: "Wipe up" },
  { value: "wipedown", label: "Wipe down" },
  { value: "slideleft", label: "Slide left" },
  { value: "slideright", label: "Slide right" },
  { value: "slideup", label: "Slide up" },
  { value: "slidedown", label: "Slide down" },
  { value: "circleopen", label: "Circle open" },
  { value: "circleclose", label: "Circle close" },
  { value: "radial", label: "Radial" },
];

// Map each transition to a CSS animation class suffix for the in-app preview
// (the exported MP4 uses FFmpeg's exact xfade; the preview is a close, but now
// visibly distinct, approximation). Each suffix has matching keyframes in the
// <style> block below.
const PREVIEW_ANIM: Record<string, string> = {
  crossfade: "fade",
  dissolve: "fade",
  radial: "fade",
  fadeblack: "fadeblack",
  fadewhite: "fadewhite",
  pixelize: "pixelize",
  wipeleft: "wipeleft",
  wiperight: "wiperight",
  wipeup: "wipeup",
  wipedown: "wipedown",
  slideleft: "slideleft",
  slideright: "slideright",
  slideup: "slideup",
  slidedown: "slidedown",
  circleopen: "circleopen",
  circleclose: "circleopen",
};

function uid() {
  return Math.random().toString(36).slice(2);
}

// Uploads can legitimately take a while on a slow connection or a big video,
// but they should never hang forever — a stuck fetch (dropped connection,
// bucket/network hiccup) used to leave the per-clip spinner spinning with no
// way out. Each leg gets its own timeout so a failure surfaces as a clear
// error instead of an infinite "uploading" badge.
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("Timed out — check your connection and try again");
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

async function presignAndUpload(file: File): Promise<string> {
  const res = await fetchWithTimeout(
    "/api/storage/uploads/request-url",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
    },
    20_000,
  );
  if (!res.ok) throw new Error("Could not get upload URL");
  const { uploadURL, objectPath } = await res.json();
  // Large video uploads need more room than the request-url call, but still a
  // hard ceiling so a dropped connection fails loudly instead of spinning.
  const put = await fetchWithTimeout(
    uploadURL,
    { method: "PUT", headers: { "Content-Type": file.type }, body: file },
    5 * 60_000,
  );
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

// Visual drag-to-trim bar: a thumbnail strip with two handles. Dragging the left
// handle sets the front trim, the right handle the back trim; the kept region is
// outlined and the trimmed ends dimmed. Enforces a 0.3s minimum kept length.
function TrimBar({
  durationSec, trimStart, trimEnd, thumb, onChange,
}: {
  durationSec: number;
  trimStart: number;
  trimEnd: number;
  thumb: string | null;
  onChange: (front: number, back: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<null | "start" | "end">(null);
  const pct = (sec: number) => `${Math.max(0, Math.min(100, (sec / durationSec) * 100))}%`;
  const keepRight = durationSec - trimEnd; // seconds position of the back handle

  const down = (which: "start" | "end") => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = which;
    barRef.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    let sec = ((e.clientX - rect.left) / rect.width) * durationSec;
    sec = Math.max(0, Math.min(durationSec, sec));
    if (dragging.current === "start") {
      onChange(Math.max(0, Math.min(sec, durationSec - 0.3 - trimEnd)), trimEnd);
    } else {
      onChange(trimStart, Math.max(0, Math.min(durationSec - sec, durationSec - 0.3 - trimStart)));
    }
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = null;
    barRef.current?.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className="select-none">
      <div
        ref={barRef}
        onPointerMove={move}
        onPointerUp={up}
        className="relative h-14 w-full overflow-hidden rounded-md border border-border bg-black/40 touch-none"
        style={thumb ? { backgroundImage: `url(${thumb})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {/* dimmed trimmed ends */}
        <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: pct(trimStart) }} />
        <div className="absolute inset-y-0 right-0 bg-black/60" style={{ width: pct(trimEnd) }} />
        {/* kept-region outline */}
        <div className="pointer-events-none absolute inset-y-0 border-2 border-primary" style={{ left: pct(trimStart), right: pct(trimEnd) }} />
        {/* handles */}
        <div
          onPointerDown={down("start")}
          className="absolute inset-y-0 z-10 -ml-2 flex w-4 cursor-ew-resize items-center justify-center rounded bg-primary/90"
          style={{ left: pct(trimStart) }}
        >
          <span className="h-5 w-0.5 rounded bg-white/90" />
        </div>
        <div
          onPointerDown={down("end")}
          className="absolute inset-y-0 z-10 -ml-2 flex w-4 cursor-ew-resize items-center justify-center rounded bg-primary/90"
          style={{ left: pct(keepRight) }}
        >
          <span className="h-5 w-0.5 rounded bg-white/90" />
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>0s</span>
        <span>{durationSec.toFixed(1)}s</span>
      </div>
    </div>
  );
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
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [videoName, setVideoName] = useState("");
  // The ID of the source video loaded from Gallery — used as the audio source
  // for Auto-sync when no separate music file has been added.
  const [sourceVideoId, setSourceVideoId] = useState<string | null>(null);
  const [lyricsText, setLyricsText] = useState("");
  const [lyricsSyncSource, setLyricsSyncSource] = useState<"music" | "video">("music");
  const [lyricsSyncing, setLyricsSyncing] = useState(false);
  const [lyricsSyncNote, setLyricsSyncNote] = useState<string | null>(null);
  // Monotonic token guarding async music loads: when the user picks a new track
  // while a previous upload/import is still in flight, the stale completion must
  // not overwrite (or null out) the newer selection.
  const musicLoadIdRef = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  // Beat sync: detected from the added music track (BPM + beat times).
  const [beatInfo, setBeatInfo] = useState<{ bpm: number; beats: number[] } | null>(null);
  const [analyzingBeats, setAnalyzingBeats] = useState(false);
  const [beatsPerPhoto, setBeatsPerPhoto] = useState(2);
  const [acceptedCopyright, setAcceptedCopyright] = useState(false);
  const { data: statsData } = useGetDashboardStats({});
  const balance = statsData?.creditsRemaining ?? null;
  const [topUpOpen, setTopUpOpen] = useState(false);

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

  // Auto-import a track handed off from a partner site (e.g. Digital Drift):
  // /editor?audio=<url>&title=<name> loads the song as the music track, like a
  // Suno link. Runs once, after auth (import requires a signed-in user).
  const autoImportedRef = useRef(false);
  useEffect(() => {
    if (autoImportedRef.current || !isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const audio = params.get("audio");
    if (!audio) return;
    autoImportedRef.current = true;
    const title = params.get("title") || "Imported track";
    // Strip the params so a refresh doesn't re-import.
    window.history.replaceState({}, "", window.location.pathname);
    const loadId = ++musicLoadIdRef.current;
    setMusic({ name: "Loading…", objectPath: null, localUrl: null, mode: "mix", volume: 0.6, uploading: true });
    (async () => {
      try {
        const r = await fetch("/api/audio/import-from-link", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: audio, title }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Import failed");
        // A newer selection replaced this one while it was importing — ignore.
        if (musicLoadIdRef.current !== loadId) return;
        setMusic({ name: data.title || title, objectPath: data.objectPath, localUrl: data.url, mode: "mix", volume: 0.6, uploading: false });
        toast({ title: "Track loaded", description: "Your song is ready — add clips or photos and render." });
      } catch (err) {
        if (musicLoadIdRef.current !== loadId) return;
        setMusic(null);
        toast({ title: "Couldn't load the track", description: String((err as Error).message), variant: "destructive" });
      }
    })();
  }, [isAuthenticated, toast]);

  // When a music track finishes uploading, analyze it for BPM + beat times so
  // the user can auto-cut photos to the beat.
  useEffect(() => {
    const path = music?.objectPath;
    if (!path) {
      setBeatInfo(null);
      return;
    }
    let cancelled = false;
    setAnalyzingBeats(true);
    fetch("/api/audio/analyze", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectPath: path }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const bpm = Number(data.bpm) || 0;
        const beats = Array.isArray(data.beatTimestamps) ? (data.beatTimestamps as number[]) : [];
        if (bpm > 0) setBeatInfo({ bpm, beats });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAnalyzingBeats(false);
      });
    return () => {
      cancelled = true;
    };
  }, [music?.objectPath]);

  const trialActive = !!user?.trialEndsAt && new Date(user.trialEndsAt).getTime() > Date.now();
  const trialDaysLeft = user?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(user.trialEndsAt).getTime() - Date.now()) / 86400000))
    : 0;
  const fullAccess = !!user && (user.isAdmin || user.subscriptionStatus === "active" || trialActive);

  // Free-Remix quota (only relevant for non-subscribers after trial).
  const [quota, setQuota] = useState<{
    used: number;
    free: number;
    remaining: number;
    overageCost: number;
    trial: { lyricUsed: number; lyricFree: number; lyricRemaining: number; lyricOverageCost: number } | null;
  } | null>(null);
  useEffect(() => {
    // Subscribers/admins are unlimited; trial users still need the quota for
    // their limited karaoke-lyric allowance.
    if (!isAuthenticated || (fullAccess && !trialActive) || user?.subscriptionStatus === "active" || user?.isAdmin) return;
    fetch("/api/studio/quota", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setQuota(d))
      .catch(() => {});
  }, [isAuthenticated, fullAccess, trialActive, user?.subscriptionStatus, user?.isAdmin]);

  // Logged-out visitors get a teaser (below) instead of a redirect, so they can
  // see what Remix Lab does and sign up.

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
      if (typeof init?.videoId === "string" && init.videoId) {
        setSourceVideoId(init.videoId);
        setLyricsSyncSource("video");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const totalDuration = segments.reduce((s, x) => s + (x.durationSec || 0), 0);
  const uploadsPending = segments.some((s) => s.uploading) || music?.uploading;

  // Remix Lab is pure ffmpeg (no AI cost), so the real charge is the flat
  // freemium overage (studio.ts): free on trial/subscription and within the
  // monthly free allotment, otherwise a small flat fee per export — never
  // size-scaled. Trial exception: karaoke lyric burns beyond the trial
  // allowance cost the standard lyric add-on. Mirror the server's quota so the
  // shown estimate matches what's actually charged.
  const trialLyricCost =
    trialActive && quota?.trial && lyricsText.trim() && quota.trial.lyricRemaining <= 0
      ? quota.trial.lyricOverageCost
      : 0;
  const estimatedCost = trialActive
    ? trialLyricCost
    : quota && quota.remaining <= 0
      ? quota.overageCost
      : 0;

  function patchSegment(id: string, patch: Partial<Segment>) {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  // Beat length for the current selection (seconds a photo should hold).
  const beatPhotoSeconds = beatInfo
    ? Math.max(0.5, Math.round(beatsPerPhoto * (60 / beatInfo.bpm) * 10) / 10)
    : 0;

  // Auto-edit to the beat: set every photo's duration to a whole number of
  // beats so its cut lands on the beat grid. Video clips keep their length.
  function syncPhotosToBeat() {
    if (!beatInfo) return;
    setSegments((prev) =>
      prev.map((s) => (s.kind === "photo" ? { ...s, durationSec: beatPhotoSeconds } : s)),
    );
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

  // Animate whichever element is CURRENTLY showing the new segment (call this
  // AFTER showSegment has swapped it in), revealing the captured previous frame
  // beneath. Applying it post-swap is what makes photo↔video transitions work —
  // the class lands on the element the viewer actually sees.
  function animateTransition() {
    if (transition === "none") return;
    const incoming =
      videoRef.current && videoRef.current.style.display !== "none" ? videoRef.current : photoRef.current;
    const tp = transPrevRef.current;
    if (stageRef.current) stageRef.current.style.setProperty("--bvtd", `${transitionDuration}s`);
    if (tp && tp.getAttribute("src")) tp.style.display = "block";
    if (incoming) {
      const cls = `bv-anim-${PREVIEW_ANIM[transition] || "fade"}`;
      [...incoming.classList].forEach((c) => c.startsWith("bv-anim-") && incoming.classList.remove(c));
      void incoming.offsetWidth; // restart the animation
      incoming.classList.add(cls);
      window.setTimeout(() => {
        incoming.classList.remove(cls);
        if (tp) tp.style.display = "none";
      }, transitionDuration * 1000 + 80);
    }
  }

  // Instant demo: when the user picks a transition (while paused), replay it on
  // the current frame so they can see what it does without hitting play.
  useEffect(() => {
    if (transition === "none") return;
    if (playingRef.current) return;
    if (segmentsRef.current.length === 0) return;
    captureTransPrev();
    const id = requestAnimationFrame(() => animateTransition());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transition]);

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
      // Capture the OLD frame, swap to the new segment, THEN animate the new
      // element over the captured frame.
      if (transition !== "none") captureTransPrev();
      showSegment(next, true);
      if (transition !== "none") requestAnimationFrame(() => animateTransition());
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
    const AUDIO_EXTS = new Set(["mp3","wav","flac","ogg","oga","m4a","aac","opus","wma","aiff","aif"]);
    let routedAudio = false;
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isVideo = file.type.startsWith("video/") || VIDEO_EXTS.has(ext);
      const isImage = file.type.startsWith("image/") || IMAGE_EXTS.has(ext);
      const isAudio = !isVideo && (file.type.startsWith("audio/") || AUDIO_EXTS.has(ext));
      if (isAudio) {
        // Users often pick their song via "Add media" — route it to the music
        // slot instead of rejecting it (only one music track is supported).
        if (routedAudio || music) {
          toast({ title: "Only one music track", description: `"${file.name}" skipped — a music track is already loaded. Use "Change music" to swap it.` });
          continue;
        }
        routedAudio = true;
        toast({ title: "Added as music track", description: `"${file.name}" was loaded as the soundtrack.` });
        void addMusicFile(file);
        continue;
      }
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
    await addMusicFile(file);
  }

  async function addMusicFile(file: File) {
    const loadId = ++musicLoadIdRef.current;
    const localUrl = URL.createObjectURL(file);
    setMusic({ name: file.name, objectPath: null, localUrl, mode: "mix", volume: 0.6, uploading: true });
    try {
      const objectPath = await presignAndUpload(file);
      // A newer selection replaced this one while it was uploading — ignore.
      if (musicLoadIdRef.current !== loadId) return;
      setMusic((m) => (m ? { ...m, objectPath, uploading: false } : m));
    } catch (err) {
      if (musicLoadIdRef.current !== loadId) return;
      setMusic(null);
      toast({ title: "Music upload failed", description: String((err as Error).message), variant: "destructive" });
    }
  }

  // Auto-sync lyrics (2 credits). The user can choose either source whenever
  // both are available; a single available source is selected automatically.
  // Video audio comes from a Gallery video (sourceVideoId) or, failing that,
  // the first uploaded video clip in the timeline — its uploaded object path
  // is transcribed directly (AssemblyAI reads a video file's audio track).
  const uploadedVideoPath =
    segments.find((s) => s.kind === "video" && s.objectPath)?.objectPath ?? null;
  const musicSyncAvailable = !!music?.objectPath;
  const videoSyncAvailable = !!sourceVideoId || !!uploadedVideoPath;
  const syncFromMusic = lyricsSyncSource === "music" && musicSyncAvailable;
  const syncFromVideo = lyricsSyncSource === "video" && videoSyncAvailable;
  const effectiveSyncSource = syncFromMusic || !videoSyncAvailable ? "music" : "video";
  const canAutoSync = musicSyncAvailable || videoSyncAvailable;
  const autoSyncLyrics = async () => {
    if (!canAutoSync || lyricsSyncing) return;
    setLyricsSyncing(true);
    setLyricsSyncNote(null);
    try {
      // acceptCopyright must be a real boolean — the API rejects the string
      // "true" with a 400 (strict `!== true` check server-side).
      const body: Record<string, string | boolean | undefined> = {
        lyricsText: lyricsText.trim() || undefined,
        acceptCopyright: true,
      };
      if (effectiveSyncSource === "music" && music?.objectPath) {
        body.audioObjectPath = music.objectPath;
      } else if (sourceVideoId) {
        body.videoId = sourceVideoId!;
      } else if (uploadedVideoPath) {
        body.audioObjectPath = uploadedVideoPath;
      } else {
        setLyricsSyncNote("Add a music track or a video clip first.");
        return;
      }
      const res = await fetch(`/api/lyrics/align`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLyricsSyncNote(data?.error || "Auto-sync failed. Please try again.");
        return;
      }
      if (typeof data?.lrc === "string" && data.lrc.trim()) {
        setLyricsText(data.lrc);
        setLyricsSyncNote(
          data?.source === "asr"
            ? "Lyrics transcribed from the track and timed word-by-word — review below."
            : "Your lyrics are now timed word-by-word to the vocals.",
        );
      } else {
        setLyricsSyncNote("Auto-sync couldn't detect vocals in this track.");
      }
    } catch {
      setLyricsSyncNote("Network error — please try again.");
    } finally {
      setLyricsSyncing(false);
    }
  };

  // Import a track from a Suno link into the timeline as the music.
  async function addMusicFromLink() {
    const url = window.prompt("Paste a public Suno song link (suno.com/song/…)");
    if (!url || !url.trim()) return;
    const loadId = ++musicLoadIdRef.current;
    setMusic({ name: "Loading…", objectPath: null, localUrl: null, mode: "mix", volume: 0.6, uploading: true });
    try {
      const r = await fetch("/api/audio/import-from-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Import failed");
      // A newer selection replaced this one while it was importing — ignore.
      if (musicLoadIdRef.current !== loadId) return;
      setMusic({
        name: data.title || "Imported track",
        objectPath: data.objectPath,
        localUrl: data.url,
        mode: "mix",
        volume: 0.6,
        uploading: false,
      });
    } catch (err) {
      if (musicLoadIdRef.current !== loadId) return;
      setMusic(null);
      toast({ title: "Couldn't import track", description: String((err as Error).message), variant: "destructive" });
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
    // Proactive credit check — show the top-up modal instead of letting the
    // user hit a backend 402 after submitting.
    if (!canAffordCredits(estimatedCost, balance)) {
      setTopUpOpen(true);
      return;
    }
    pause();
    setSubmitting(true);
    try {
      // Fall back to a friendly, dated default when the user leaves it blank —
      // never the generic "Editor export".
      const finalName =
        videoName.trim() ||
        `Remix Lab · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
      const body = {
        name: finalName,
        segments: ready.map((s) => ({
          objectPath: s.objectPath,
          kind: s.kind,
          // Clamp to the server's accepted range (0.5–600s) so a long clip
          // never triggers a validation error on the render request.
          durationSec: Math.min(600, Math.max(0.5, s.durationSec || 3)),
          // Front/back trim (video only; omit when zero).
          ...(s.kind === "video" && (s.trimStart || s.trimEnd)
            ? { trimStart: s.trimStart || 0, trimEnd: s.trimEnd || 0 }
            : {}),
        })),
        music: music?.objectPath
          ? { objectPath: music.objectPath, mode: music.mode, volume: music.volume, loop: music.loop !== false, fade: !!music.fade }
          : undefined,
        transition: transition === "none" ? undefined : { type: transition, durationSec: transitionDuration },
        resolution,
        orientation,
        acceptCopyright: true,
        lyricsText: lyricsText.trim() || undefined,
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
      if (!res.ok) {
        // Surface the server's actual error instead of a bare status code.
        const e = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(e.error || `Render request failed (${res.status})`);
      }
      const { job } = await res.json();
      setLocation(`/jobs/${job.id}`);
    } catch (err) {
      toast({ title: "Export failed", description: String((err as Error).message), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!isAuthenticated) return isAuthLoading ? null : <SignupTeaser variant="remix" />;

  return (
    <>
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <style>{`
        @keyframes bvFade{from{opacity:0}to{opacity:1}}
        @keyframes bvFadeBlack{0%{opacity:1;filter:brightness(0)}45%{opacity:1;filter:brightness(0)}100%{opacity:1;filter:brightness(1)}}
        @keyframes bvFadeWhite{0%{opacity:1;filter:brightness(6) contrast(0)}45%{opacity:1;filter:brightness(6) contrast(0)}100%{opacity:1;filter:brightness(1) contrast(1)}}
        @keyframes bvPixelize{from{opacity:0;filter:blur(16px)}to{opacity:1;filter:blur(0)}}
        @keyframes bvWipeLeft{from{clip-path:inset(0 0 0 100%)}to{clip-path:inset(0 0 0 0)}}
        @keyframes bvWipeRight{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
        @keyframes bvWipeUp{from{clip-path:inset(100% 0 0 0)}to{clip-path:inset(0 0 0 0)}}
        @keyframes bvWipeDown{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
        @keyframes bvSlideLeft{from{transform:translateX(100%)}to{transform:translateX(0)}}
        @keyframes bvSlideRight{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        @keyframes bvSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes bvSlideDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}
        @keyframes bvCircleOpen{from{clip-path:circle(0% at 50% 50%)}to{clip-path:circle(75% at 50% 50%)}}
        .bv-anim-fade{animation:bvFade var(--bvtd,.5s) ease both}
        .bv-anim-fadeblack{animation:bvFadeBlack var(--bvtd,.5s) ease both}
        .bv-anim-fadewhite{animation:bvFadeWhite var(--bvtd,.5s) ease both}
        .bv-anim-pixelize{animation:bvPixelize var(--bvtd,.5s) ease both}
        .bv-anim-wipeleft{animation:bvWipeLeft var(--bvtd,.5s) ease both}
        .bv-anim-wiperight{animation:bvWipeRight var(--bvtd,.5s) ease both}
        .bv-anim-wipeup{animation:bvWipeUp var(--bvtd,.5s) ease both}
        .bv-anim-wipedown{animation:bvWipeDown var(--bvtd,.5s) ease both}
        .bv-anim-slideleft{animation:bvSlideLeft var(--bvtd,.5s) ease both}
        .bv-anim-slideright{animation:bvSlideRight var(--bvtd,.5s) ease both}
        .bv-anim-slideup{animation:bvSlideUp var(--bvtd,.5s) ease both}
        .bv-anim-slidedown{animation:bvSlideDown var(--bvtd,.5s) ease both}
        .bv-anim-circleopen{animation:bvCircleOpen var(--bvtd,.5s) ease both}
      `}</style>

      <div className="mb-6">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent mb-3">
          <Sparkles className="h-3.5 w-3.5" />
          Remix Lab
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
          Your cut, <span className="text-gradient-electric">your rules</span>
        </h1>
        <p className="text-muted-foreground mt-2 text-sm md:text-base max-w-2xl">
          Turn your photos and clips into a polished video — the easy, AI-powered
          alternative to CapCut. Made for weddings, work, social — or just for fun.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {["1080p export", "No watermark", "Music sync", "Smooth transitions", "Live preview"].map((chip) => (
            <span
              key={chip}
              className="text-xs font-medium text-muted-foreground border border-border/60 rounded-full px-2.5 py-1 bg-secondary/40"
            >
              {chip}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground text-center">
          <a href="https://aipodsync.com" className="text-primary font-medium hover:underline">
            Create your own podcast with AIPodSync
          </a>
        </p>
      </div>

      {trialActive && (
        <Card className="border-primary/30 bg-primary/5 mb-6 p-4 text-sm">
          Free trial — {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left. The full Remix Lab is unlocked: 1080p,
          no watermark, smooth transitions.{" "}
          {segments.length > 0 &&
            (estimatedCost > 0 ? (
              <>This export includes a karaoke lyric burn beyond your trial allowance, so it costs <strong>{estimatedCost} credits</strong>.{" "}</>
            ) : (
              <>Exports are <strong>free</strong> while you're on the trial.{" "}</>
            ))}
          <button className="text-primary font-medium underline" onClick={() => setLocation("/pricing")}>
            Subscribe
          </button>{" "}
          to keep it after your trial.
        </Card>
      )}
      {!fullAccess && (
        <Card className="border-primary/30 bg-primary/5 mb-6 p-4 text-sm">
          {quota && quota.remaining > 0 ? (
            <>
              <strong>{quota.remaining} of {quota.free} free Remix exports</strong> left this month. After that,
              each export is just {quota.overageCost} credits (~$
              {(quota.overageCost * 0.02).toFixed(2)}).{" "}
            </>
          ) : quota ? (
            <>
              You've used all {quota.free} free Remix exports this month. Each additional export is{" "}
              <strong>{quota.overageCost} credits</strong> (~${(quota.overageCost * 0.02).toFixed(2)}).{" "}
            </>
          ) : (
            <>The first {10} Remix exports each month are free.{" "}</>
          )}
          <button className="text-primary font-medium underline" onClick={() => setLocation("/pricing")}>
            Subscribe
          </button>{" "}
          for unlimited exports.
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
          <Button size="icon" variant="outline" onClick={togglePlay} className="h-9 w-9 shrink-0" aria-label={playing ? "Pause preview" : "Play preview"}>
            {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </Button>
          <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded">
            <div className="bg-primary h-full rounded" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="text-muted-foreground w-14 text-right text-xs tabular-nums">{totalDuration.toFixed(1)}s</span>
        </div>
      )}

      <div className="mb-4">
        <TutorialTip id="remixlab" title="Remix Lab basics">
          Add your clips and photos, add music (upload, Suno, or one of your Soundtracks), then arrange them on the
          timeline. Detect the beat to auto-sync photo cuts, set a transition, and export — free on trial and for subscribers.
        </TutorialTip>
      </div>

      {/* Add media */}
      <div className="mb-4 flex flex-wrap gap-3">
        <input ref={mediaInputRef} type="file" accept="video/*,image/*,audio/*,.mp4,.mov,.webm,.mkv,.avi,.wmv,.m4v,.3gp,.ts,.ogv,.mp3,.wav,.flac,.m4a,.aac,.ogg" multiple hidden onChange={(e) => addMedia(e.target.files)} />
        <Button onClick={() => mediaInputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> Add media
        </Button>
        <input ref={musicInputRef} type="file" accept="audio/*" hidden onChange={(e) => addMusic(e.target.files)} />
        <Button variant="outline" onClick={() => musicInputRef.current?.click()}>
          <Music className="mr-2 h-4 w-4" /> {music ? "Change music" : "Add music"}
        </Button>
        <Button variant="outline" onClick={addMusicFromLink} data-testid="add-music-from-link">
          <Link2 className="mr-2 h-4 w-4" /> Add from Suno
        </Button>
        <SoundtrackPickerDialog
          onSelect={(t) => {
            // Invalidate any in-flight upload/import so its completion (or
            // failure) can't overwrite or null out this selection.
            musicLoadIdRef.current++;
            setMusic({ name: t.title, objectPath: t.objectPath, localUrl: t.url, mode: "mix", volume: 0.6, uploading: false });
          }}
        >
          <Button variant="outline" data-testid="add-music-from-soundtracks">
            <Music className="mr-2 h-4 w-4 text-primary" /> Add from Soundtracks
          </Button>
        </SoundtrackPickerDialog>
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
                    {Math.max(0, (seg.durationSec || 0) - (seg.trimStart || 0) - (seg.trimEnd || 0)).toFixed(1)}s
                    {(seg.trimStart || seg.trimEnd) ? " ✂" : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Trim panel for the selected video clip */}
        {(() => {
          const sel = segments[previewIndex];
          if (!sel || sel.kind !== "video" || !sel.durationSec) return null;
          const ts = sel.trimStart || 0;
          const te = sel.trimEnd || 0;
          const kept = Math.max(0.3, sel.durationSec - ts - te);
          const setTrim = (front: number, back: number) => {
            const f = Math.max(0, Math.min(front, sel.durationSec - 0.3 - back));
            const b = Math.max(0, Math.min(back, sel.durationSec - 0.3 - f));
            patchSegment(sel.id, { trimStart: f, trimEnd: b });
          };
          return (
            <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Scissors className="h-3.5 w-3.5 text-primary" /> Trim clip {previewIndex + 1}
                </span>
                <span className="text-xs text-muted-foreground">{kept.toFixed(1)}s of {sel.durationSec.toFixed(1)}s</span>
              </div>
              <div className="mb-3">
                <TrimBar
                  durationSec={sel.durationSec}
                  trimStart={ts}
                  trimEnd={te}
                  thumb={sel.thumb}
                  onChange={setTrim}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">Drag the handles to resize the clip.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-muted-foreground">
                  Trim front (s)
                  <input
                    type="number" min={0} step={0.1} value={ts}
                    onChange={(e) => setTrim(Number(e.target.value) || 0, te)}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Trim back (s)
                  <input
                    type="number" min={0} step={0.1} value={te}
                    onChange={(e) => setTrim(ts, Number(e.target.value) || 0)}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                  />
                </label>
              </div>
              {(ts > 0 || te > 0) && (
                <button
                  onClick={() => patchSegment(sel.id, { trimStart: 0, trimEnd: 0 })}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Reset trim
                </button>
              )}
            </div>
          );
        })()}

        <p className="text-muted-foreground mt-3 text-xs">
          Drag blocks to reorder · click to preview · trim the front/back of the selected clip · set a photo's seconds in its box
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

          <div className="mt-6">
            <div className="mb-2 text-sm font-medium">Video name</div>
            <input
              type="text"
              value={videoName}
              onChange={(e) => setVideoName(e.target.value)}
              placeholder="Name your video (optional)"
              maxLength={120}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              data-testid="editor-video-name"
            />
            <p className="mt-1 text-xs text-muted-foreground">Shown in your library and gallery. Leave blank for a dated default.</p>
          </div>

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

          <div className="mt-4">
            <div className="mb-2 text-sm font-medium">Orientation</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOrientation("landscape")}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                  orientation === "landscape"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
                }`}
                data-testid="orientation-landscape"
              >
                <span className="inline-block w-5 h-3 rounded-[3px] border-2 border-current" />
                16:9 · Wide
              </button>
              <button
                type="button"
                onClick={() => setOrientation("portrait")}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                  orientation === "portrait"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
                }`}
                data-testid="orientation-portrait"
              >
                <span className="inline-block w-3 h-5 rounded-[3px] border-2 border-current" />
                9:16 · Mobile
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {orientation === "portrait"
                ? "Portrait — for TikTok, Reels & YouTube Shorts."
                : "Widescreen — for YouTube & desktop."}
            </p>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 text-sm font-medium">Music</div>
          {music ? (
            <>
              <div className="mb-3 truncate text-sm">{music.name}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-muted-foreground mb-1 text-xs">Audio</div>
                  <Select value={music.mode} onValueChange={(v) => setMusic((m) => (m ? { ...m, mode: v as "mix" | "replace" } : m))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mix">Mix with clip audio</SelectItem>
                      <SelectItem value="replace">Replace clip audio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1 text-xs">Volume · {Math.round(music.volume * 100)}%</div>
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

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMusic((m) => (m ? { ...m, loop: m.loop === false } : m))}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${music.loop === false ? "border-border/60 text-muted-foreground hover:text-foreground" : "border-primary/40 bg-primary/10 text-primary"}`}
                >
                  {music.loop === false ? "Play once" : "Loop to fill ✓"}
                </button>
                <button
                  type="button"
                  onClick={() => setMusic((m) => (m ? { ...m, fade: !m.fade } : m))}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${music.fade ? "border-primary/40 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                >
                  Fade in/out {music.fade ? "✓" : ""}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {music.loop === false
                  ? "Plays once — the video is silent after the track ends."
                  : "Repeats to fill the whole video."}
              </p>
              {analyzingBeats && (
                <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Detecting beat…
                </div>
              )}
              {beatInfo && (
                <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <Music className="h-3.5 w-3.5 text-accent" />
                    {Math.round(beatInfo.bpm)} BPM detected
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Hold each photo for</span>
                    <Select value={String(beatsPerPhoto)} onValueChange={(v) => setBeatsPerPhoto(Number(v))}>
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 beat</SelectItem>
                        <SelectItem value="2">2 beats</SelectItem>
                        <SelectItem value="4">4 beats</SelectItem>
                        <SelectItem value="8">8 beats</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-accent/40 hover:bg-accent/10 hover:text-accent"
                      disabled={segments.filter((s) => s.kind === "photo").length === 0}
                      onClick={syncPhotosToBeat}
                    >
                      Sync photos to beat
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Sets every photo to {beatPhotoSeconds.toFixed(1)}s so its cut lands on the beat. Video clips keep their length.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">No track. Add one to score your video.</p>
          )}

          <div className="mt-6">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Mic2 className="h-3.5 w-3.5 text-primary" />
              Karaoke lyrics
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-primary transition-colors"
                    aria-label="How lyric timing works"
                    data-testid="button-editor-lyrics-info"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 text-sm" align="start">
                  <p className="font-semibold mb-2">How karaoke timing works</p>
                  <ul className="space-y-2 text-muted-foreground">
                    <li>
                      <span className="text-foreground font-medium">Plain lyrics</span> — lines are
                      spread evenly across the video; word fill is estimated.
                    </li>
                    <li>
                      <span className="text-foreground font-medium">LRC timestamps</span> —{" "}
                      <code className="text-xs bg-muted/40 px-1 rounded">[00:12.50]</code> before a
                      line makes it appear exactly then.
                    </li>
                    <li>
                      <span className="text-foreground font-medium">Word-level tags</span> —{" "}
                      <code className="text-xs bg-muted/40 px-1 rounded">&lt;00:12.80&gt;</code> before
                      each word syncs the fill word-by-word.
                    </li>
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Words fill in as they're sung, burned into the export.
                  </p>
                </PopoverContent>
              </Popover>
            </div>
            {trialActive && quota?.trial && (
              <p className="mb-2 text-xs text-muted-foreground" data-testid="text-trial-lyric-allowance">
                {quota.trial.lyricRemaining > 0 ? (
                  <>
                    Free trial includes{" "}
                    <strong className="text-foreground">
                      {quota.trial.lyricRemaining} of {quota.trial.lyricFree} karaoke lyric exports
                    </strong>
                    . After that, each lyric export is {quota.trial.lyricOverageCost} credits.
                  </>
                ) : (
                  <>
                    You've used your {quota.trial.lyricFree} free trial karaoke exports — extra lyric
                    exports cost {quota.trial.lyricOverageCost} credits, or{" "}
                    <Link href="/pricing" className="text-primary underline">subscribe for unlimited</Link>.
                  </>
                )}
              </p>
            )}
            <Textarea
              placeholder="Optional — paste lyrics here, or leave empty and hit Auto-sync to transcribe them from the track. LRC with [mm:ss] timestamps works too…"
              className="min-h-[90px] resize-none text-sm"
              value={lyricsText}
              onChange={(e) => setLyricsText(e.target.value)}
              maxLength={5000}
              disabled={lyricsSyncing}
              data-testid="textarea-editor-lyrics"
            />
            <div className="flex items-center justify-between gap-3 mt-1.5">
              <p className="text-xs text-muted-foreground">
                {lyricsText.length}/5000 characters
                {/\[\d{1,2}:\d{2}/.test(lyricsText)
                  ? " · LRC timestamps detected — exact sync"
                  : lyricsText.trim()
                    ? " · no timestamps — lines will be spread evenly (paste LRC for exact sync)"
                    : ""}
              </p>
              {!lyricsText.trim() && (
                <button
                  type="button"
                  onClick={() => setLyricsText(SAMPLE_LYRICS)}
                  className="text-xs text-primary hover:underline shrink-0"
                  data-testid="button-editor-lyrics-sample"
                >
                  Try a sample
                </button>
              )}
            </div>

            {/* Auto-sync to vocals — user can pick the source when both are available */}
            <div className="mt-3 space-y-2">
              {/* Source selector — only shown when both music and video are available */}
              {musicSyncAvailable && videoSyncAvailable && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0">Sync from:</span>
                  <button
                    type="button"
                    onClick={() => { setLyricsSyncSource("music"); setLyricsSyncNote(null); }}
                    className={`px-2.5 py-0.5 rounded-full border transition-colors ${
                      lyricsSyncSource === "music"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                    data-testid="button-sync-source-music"
                  >
                    Music track
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLyricsSyncSource("video"); setLyricsSyncNote(null); }}
                    className={`px-2.5 py-0.5 rounded-full border transition-colors ${
                      lyricsSyncSource === "video"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                    data-testid="button-sync-source-video"
                  >
                    Video audio
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {lyricsSyncNote ??
                    (!canAutoSync
                      ? "Add a music track or a video clip above so Auto-sync can time each word to the vocals (2 credits)."
                      : /\[\d{1,2}:\d{2}/.test(lyricsText)
                          ? "Timestamps detected — already synced."
                          : effectiveSyncSource === "music"
                            ? "Auto-sync times each word to your music track (2 credits). Leave the box empty to transcribe the lyrics too."
                            : "Auto-sync times each word to the video's own audio (2 credits). Leave the box empty to transcribe the lyrics too.")}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={autoSyncLyrics}
                  disabled={lyricsSyncing || !canAutoSync}
                  className="gap-2 shrink-0"
                  data-testid="button-editor-autosync"
                >
                  {lyricsSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {lyricsSyncing ? "Listening to the track…" : "Auto-sync to vocals"}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="Auto-sync cost details" className="text-muted-foreground hover:text-foreground transition-colors shrink-0" data-testid="tooltip-editor-autosync-cost">
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                    Auto-sync costs {LYRIC_ALIGN_COST} credits each run — AI listens to the audio and times every word to the vocals. The synced lyrics are then burned into your export as karaoke captions.
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Copyright attestation */}
      <label className="mb-4 flex items-start gap-2.5 text-sm text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={acceptedCopyright}
          onChange={(e) => setAcceptedCopyright(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span>
          I confirm I have the right to use this content (owned, licensed, or royalty-free).
        </span>
      </label>

      {/* Export */}
      <div className="flex items-center gap-3">
        <Button
          size="lg"
          onClick={exportVideo}
          disabled={submitting || !!uploadsPending || segments.length === 0 || !acceptedCopyright}
        >
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Export &amp; render MP4
        </Button>
        {uploadsPending && <span className="text-muted-foreground text-sm">Uploading…</span>}
        {!uploadsPending && segments.length > 0 && (trialActive || !fullAccess) && (
          <span className="text-muted-foreground text-sm tabular-nums">
            {trialActive ? (
              estimatedCost > 0 ? (
                <>Est. cost: {estimatedCost} credits (lyric add-on)</>
              ) : (
                <span className="text-primary">Free during trial</span>
              )
            ) : quota && quota.remaining > 0 ? (
              <span className="text-primary">Free · {quota.remaining} of {quota.free} left this month</span>
            ) : quota ? (
              <>Est. cost: {quota.overageCost} credits</>
            ) : null}
          </span>
        )}
      </div>
    </div>

    <TopUpRequiredDialog
      open={topUpOpen}
      onOpenChange={setTopUpOpen}
      creditsRequired={estimatedCost}
      creditsRemaining={balance ?? 0}
      title="More credits needed to export"
    />
    </>
  );
}
