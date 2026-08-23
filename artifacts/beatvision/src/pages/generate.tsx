import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { AudioWaveformSelector } from "@/components/AudioWaveformSelector";
import SignupTeaser from "@/components/SignupTeaser";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import {
  useCreateJob,
  useAnalyzeAudio,
  useGetDashboardStats,
  CreateJobRequestAudioSourceType,
  CreateJobRequestAspectRatio,
  CreateJobRequestResolution,
  CreateJobRequestRequestedDuration,
  CreateJobRequestGenerationMode,
  CreateJobRequestNarrativeVisualSource,
  VideoStyle,
  type CreateJobRequest,
} from "@workspace/api-client-react";
import {
  estimateCreditCost,
  estimateGeneratedImageCost,
  calculateLipsyncCost,
  canAffordCredits,
  LIPSYNC_DEFAULT_SECONDS,
  LIPSYNC_MAX_SECONDS,
  LIPSYNC_MIN_SECONDS,
  LYRIC_ALIGN_COST,
  LYRIC_OVERLAY_COST,
  MAX_FULL_SECONDS,
  PROVIDER_LABELS,
  GENERATED_IMAGE_CREDITS_PER_VISUAL,
  type AiProvider,
  type GenerationMode,
} from "@/lib/creditPricing";
import { getGenerationTimeEstimate } from "@/lib/jobEstimates";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SoundtrackPickerDialog } from "@/components/SoundtrackPickerDialog";
import TopUpRequiredDialog from "@/components/TopUpRequiredDialog";
import { TutorialTip } from "@/components/TutorialTip";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { motion } from "framer-motion";
import {
  Upload, Music, Sparkles, Loader2, CheckCircle2, XCircle,
  Users, Clapperboard, Layers, Zap, Film, Wand2, Video as VideoIcon, FileText,
  ChevronDown, User, Maximize2, Captions, Pencil, MonitorPlay, ImageIcon,
  Lock, Crown, Coins, AlertTriangle, CreditCard, Clock, ShieldAlert, Info, VideoOff,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Original sample lyrics (safe to ship — written for this app) showing all
// three timing formats the karaoke engine understands: word-level tags on the
// first lines, plain [mm:ss] line tags after, and a comment for plain text.
import { SAMPLE_LYRICS } from "@/lib/sampleLyrics";
import { MAX_LYRICS_LENGTH } from "@/lib/lyricLimits";

type ErrorDialogState = {
  open: boolean;
  title: string;
  message: string;
  code?: string;
  creditsRequired?: number;
  creditsRemaining?: number;
};

const STYLES = [
  { id: VideoStyle.realistic, label: "Realistic", icon: Users },
  { id: VideoStyle.anime, label: "Anime", icon: Sparkles },
  { id: VideoStyle.cinematic, label: "Cinematic", icon: Clapperboard },
  { id: VideoStyle.abstract, label: "Abstract", icon: Layers },
  { id: VideoStyle.neon, label: "Neon Glow", icon: Zap },
  { id: VideoStyle.vintage, label: "Vintage", icon: Film },
  { id: VideoStyle.fantasy, label: "Fantasy", icon: Wand2 },
  { id: VideoStyle.documentary, label: "Docu-style", icon: VideoIcon },
];

// One-click starting points: fill prompt + style + aspect + duration so new
// users aren't staring at a blank form.
const TEMPLATES: {
  id: string;
  label: string;
  emoji: string;
  prompt: string;
  style: VideoStyle;
  aspect: CreateJobRequestAspectRatio;
  duration: CreateJobRequestRequestedDuration;
}[] = [
  { id: "neon-tiktok", label: "Neon TikTok loop", emoji: "🌆", prompt: "neon-lit city at night, glowing reflections on wet streets, cyberpunk mood, rhythmic pulsing lights", style: VideoStyle.neon, aspect: CreateJobRequestAspectRatio["9:16"], duration: CreateJobRequestRequestedDuration.NUMBER_10 },
  { id: "anime-mv", label: "Anime music video", emoji: "🌸", prompt: "anime protagonist, dynamic action poses, falling sakura petals, dramatic anime lighting and speed lines", style: VideoStyle.anime, aspect: CreateJobRequestAspectRatio["16:9"], duration: CreateJobRequestRequestedDuration.NUMBER_30 },
  { id: "cinematic", label: "Cinematic trailer", emoji: "🎬", prompt: "epic cinematic landscapes, slow sweeping camera moves, volumetric light, film grain, moody color grade", style: VideoStyle.cinematic, aspect: CreateJobRequestAspectRatio["16:9"], duration: CreateJobRequestRequestedDuration.NUMBER_30 },
  { id: "dreamy", label: "Dreamy aesthetic", emoji: "✨", prompt: "ethereal dreamscape, soft glowing haze, floating particles, pastel gradients, slow drifting motion", style: VideoStyle.fantasy, aspect: CreateJobRequestAspectRatio["9:16"], duration: CreateJobRequestRequestedDuration.NUMBER_10 },
  { id: "retro", label: "Retro 80s vibes", emoji: "📼", prompt: "retro 1980s aesthetic, VHS grain, chrome text, sunset gradient grid, synthwave mood", style: VideoStyle.vintage, aspect: CreateJobRequestAspectRatio["16:9"], duration: CreateJobRequestRequestedDuration.NUMBER_10 },
  { id: "canvas", label: "Spotify Canvas loop", emoji: "🔁", prompt: "abstract flowing liquid gradients, seamless hypnotic loop, smooth continuous motion", style: VideoStyle.abstract, aspect: CreateJobRequestAspectRatio["9:16"], duration: CreateJobRequestRequestedDuration.NUMBER_5 },
];

// Platform presets: one click sets the right aspect ratio + length for a target.
const PLATFORM_PRESETS: {
  id: string;
  label: string;
  emoji: string;
  aspect: CreateJobRequestAspectRatio;
  duration: CreateJobRequestRequestedDuration;
}[] = [
  { id: "vertical", label: "TikTok · Reels · Shorts", emoji: "📱", aspect: CreateJobRequestAspectRatio["9:16"], duration: CreateJobRequestRequestedDuration.NUMBER_10 },
  { id: "youtube", label: "YouTube", emoji: "▶️", aspect: CreateJobRequestAspectRatio["16:9"], duration: CreateJobRequestRequestedDuration.NUMBER_30 },
  { id: "canvas", label: "Spotify Canvas", emoji: "🎵", aspect: CreateJobRequestAspectRatio["9:16"], duration: CreateJobRequestRequestedDuration.NUMBER_5 },
  { id: "square", label: "Square feed", emoji: "⬜", aspect: CreateJobRequestAspectRatio["1:1"], duration: CreateJobRequestRequestedDuration.NUMBER_10 },
];

const ASPECT_RATIOS = [
  CreateJobRequestAspectRatio["16:9"],
  CreateJobRequestAspectRatio["9:16"],
  CreateJobRequestAspectRatio["1:1"],
  CreateJobRequestAspectRatio["4:3"],
  CreateJobRequestAspectRatio["21:9"],
] as const;

const RESOLUTIONS = [
  CreateJobRequestResolution["720p"],
  CreateJobRequestResolution["1080p"],
  CreateJobRequestResolution["4k"],
] as const;

// Friendly labels for the resolution picker. 4K is a premium (Pro/Studio) tier.
const RES_LABELS: Record<string, string> = {
  "720p": "720p",
  "1080p": "1080p HD",
  "4k": "4K Ultra",
};

const CHARACTERS = [
  { value: "none", label: "None" },
  { value: "a person", label: "Person" },
  { value: "a couple", label: "Couple" },
  { value: "a crowd of people", label: "Crowd" },
  { value: "an abstract form", label: "Abstract" },
  { value: "an animal", label: "Animal" },
] as const;
type CharacterValue = (typeof CHARACTERS)[number]["value"];

function formatDuration(seconds: number | null | undefined): string {
  const safeSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

// estimateCreditCost + provider pricing now live in "@/lib/creditPricing"
// (imported above) so the generate page and pricing page share one source.

export default function Generate() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const styleRef = useRef<HTMLDivElement>(null);

  const [sourceType, setSourceType] = useState<CreateJobRequestAudioSourceType>(
    CreateJobRequestAudioSourceType.upload,
  );
  const [sunoInputUrl, setSunoInputUrl] = useState("");
  const [sunoAutoResolve, setSunoAutoResolve] = useState(false);
  const [sunoResolving, setSunoResolving] = useState(false);
  const [sunoResolved, setSunoResolved] = useState<{ audioUrl: string; title: string; artist: string; objectPath?: string } | null>(null);
  const [sunoError, setSunoError] = useState<string | null>(null);
  const [objectPath, setObjectPath] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState("");
  const [quickStartOpen, setQuickStartOpen] = useState(false);
  const [quickStartTemplateId, setQuickStartTemplateId] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const audioSectionRef = useRef<HTMLDivElement>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    prompt?: string;
    audio?: string;
    lipSync?: string;
    lyrics?: string;
  }>({});
  const [selectedStyle, setSelectedStyle] = useState<VideoStyle>(VideoStyle.cinematic);
  const [imagePackMode, setImagePackMode] = useState(false);
  const [imagePackCount, setImagePackCount] = useState(4);
  const [imagePackAspectRatio, setImagePackAspectRatio] = useState<"9:16" | "16:9">("9:16");
  const [imagePackSubmitting, setImagePackSubmitting] = useState(false);
  const [generationMode, setGenerationMode] = useState<CreateJobRequestGenerationMode>(CreateJobRequestGenerationMode.montage);
  const narrativeVisualSource = CreateJobRequestNarrativeVisualSource.generated_images;
  const [lyricsEnabled, setLyricsEnabled] = useState(false);
  const [lyricsText, setLyricsText] = useState("");
  // Auto-sync: AI listens to the uploaded track and returns word-timed lyrics.
  const [lyricsSyncing, setLyricsSyncing] = useState(false);
  const [lyricsSyncNote, setLyricsSyncNote] = useState<string | null>(null);

  // New settings
  const [aspectRatio, setAspectRatio] = useState<CreateJobRequestAspectRatio>(CreateJobRequestAspectRatio["16:9"]);
  const [resolution, setResolution] = useState<CreateJobRequestResolution>(CreateJobRequestResolution["720p"]);
  // 4K is a Pro/Studio-only tier — fetch what this user can render.
  const [can4k, setCan4k] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/jobs/video-capabilities", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data) setCan4k(!!data.can4k);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  // If 4K is selected but the plan doesn't allow it, fall back to 1080p.
  useEffect(() => {
    if (!can4k && (resolution as string) === "4k") setResolution(CreateJobRequestResolution["1080p"]);
  }, [can4k, resolution]);
  // 4K is only produced by the Kling engine (Runway renders at 720 here), so
  // force Kling when 4K is chosen — otherwise the 4K surcharge wouldn't deliver 4K.
  useEffect(() => {
    if ((resolution as string) === "4k") setAiProvider("kling");
  }, [resolution]);
  const [character, setCharacter] = useState<CharacterValue>("none");
  const [requestedDuration, setRequestedDuration] = useState<CreateJobRequestRequestedDuration>(CreateJobRequestRequestedDuration.NUMBER_10);
  const [silentFilmDurationSeconds, setSilentFilmDurationSeconds] = useState(180);
  const [aiProvider, setAiProvider] = useState<AiProvider>("runway");
  const [clipStartTime, setClipStartTime] = useState(0);
  // Full-track renders do not need a Lip Sync segment. This is intentionally
  // opt-in; when enabled, the selection becomes the starting configuration for
  // the later, separately charged Lip Sync add-on.
  const [fullTrackLipSyncEnabled, setFullTrackLipSyncEnabled] = useState(false);
  const [fullTrackLipSyncSeconds, setFullTrackLipSyncSeconds] = useState(LIPSYNC_DEFAULT_SECONDS);
  const lipSyncImageInputRef = useRef<HTMLInputElement>(null);
  const [lipSyncImageObjectPath, setLipSyncImageObjectPath] = useState<string | null>(null);
  const [lipSyncImagePreviewUrl, setLipSyncImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingLipSyncImage, setIsUploadingLipSyncImage] = useState(false);
  const [lipSyncImageError, setLipSyncImageError] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [errorDialog, setErrorDialog] = useState<ErrorDialogState>({ open: false, title: "", message: "" });
  const [copyrightAcknowledged, setCopyrightAcknowledged] = useState(false);
  const [durationWarningOpen, setDurationWarningOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  // Storyboard preview shown in the confirm dialog (no charge, no render).
  type PlannedShot = {
    index: number;
    label: string;
    description?: string;
    startTime: number;
    energy: number;
    prompt: string;
  };
  const [shotPlan, setShotPlan] = useState<{
    shots: PlannedShot[];
    numClips: number;
    timelineSceneCount: number;
    reuseCount: number;
    approximate: boolean;
  } | null>(null);
  const [shotPlanLoading, setShotPlanLoading] = useState(false);

  // Reference image
  const refImageInputRef = useRef<HTMLInputElement>(null);
  const [refImageObjectPath, setRefImageObjectPath] = useState<string | null>(null);
  const [refImagePreviewUrl, setRefImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingRefImage, setIsUploadingRefImage] = useState(false);
  const [refImageError, setRefImageError] = useState<string | null>(null);

  // Handoff from the AI Song Generator: /generate?audioObjectPath=<path>&title=<name>
  // preloads that song as the uploaded audio source, ready to generate a video.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const op = params.get("audioObjectPath");
    if (!op) return;
    setSourceType(CreateJobRequestAudioSourceType.upload);
    setObjectPath(op);
    setUploadedFileName(params.get("title") || "AI Song");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Handoff from Prompt Studio: /generate?prompt=<text> prefills the prompt field.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("prompt");
    if (!p) return;
    setPrompt(p);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const handleRefImageSelect = async (file: File) => {
    if (!file) return;
    setRefImageError(null);
    setIsUploadingRefImage(true);
    const localUrl = URL.createObjectURL(file);
    setRefImagePreviewUrl(localUrl);
    try {
      const res = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const data = await res.json();
      const putRes = await fetch(data.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Storage upload failed: ${putRes.status}`);
      setRefImageObjectPath(data.objectPath);
    } catch (err) {
      setRefImageError(err instanceof Error ? err.message : "Upload failed");
      setRefImageObjectPath(null);
      setRefImagePreviewUrl(null);
    } finally {
      setIsUploadingRefImage(false);
    }
  };

  const handleLipSyncImageSelect = async (file: File) => {
    if (!file) return;
    setLipSyncImageError(null);
    setIsUploadingLipSyncImage(true);
    if (lipSyncImagePreviewUrl) URL.revokeObjectURL(lipSyncImagePreviewUrl);
    const localUrl = URL.createObjectURL(file);
    setLipSyncImagePreviewUrl(localUrl);
    try {
      const res = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const data = await res.json();
      const putRes = await fetch(data.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Storage upload failed: ${putRes.status}`);
      setLipSyncImageObjectPath(data.objectPath);
      setFieldErrors((current) => ({ ...current, lipSync: undefined }));
    } catch (err) {
      setLipSyncImageError(err instanceof Error ? err.message : "Upload failed");
      setLipSyncImageObjectPath(null);
      setLipSyncImagePreviewUrl(null);
    } finally {
      setIsUploadingLipSyncImage(false);
    }
  };

  const durationToSeconds = useCallback((dur: CreateJobRequestRequestedDuration): number | null => {
    if (dur === CreateJobRequestRequestedDuration.full) return null;
    return parseInt(dur as string, 10);
  }, []);

  const handleDurationChange = useCallback((dur: CreateJobRequestRequestedDuration) => {
    setRequestedDuration(dur);
    setClipStartTime(0);
  }, []);

  const handleFileSelect = async (file: File) => {
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").pop() ?? "";
    // Some browsers report an empty or generic MIME type for local files.
    // Preserve the extension so the upload service and ffmpeg can still
    // identify MP3/MP4 correctly.
    const contentType =
      file.type && file.type !== "application/octet-stream"
        ? file.type
        : extension === "mp4"
          ? "video/mp4"
          : extension === "mp3"
            ? "audio/mpeg"
            : file.type || "application/octet-stream";
    setUploadedFile(file);
    setClipStartTime(0);
    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(0);
    setUploadedFileName(file.name);
    try {
      const res = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const data = await res.json();

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.open("PUT", data.uploadURL);
        xhr.setRequestHeader("Content-Type", contentType);
        xhr.send(file);
      });

      setObjectPath(data.objectPath);
      setUploadProgress(100);
      toast({ title: "Audio ready", description: `${file.name} uploaded successfully.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadError(msg);
      setUploadedFileName(null);
      setObjectPath(null);
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const { toast } = useToast();
  const createJob = useCreateJob();
  const { data: statsData } = useGetDashboardStats({});
  const analyzeAudio = useAnalyzeAudio();
  // Track which objectPath the current analysis result belongs to. This prevents
  // an old upload's duration from sizing or billing a newly uploaded track.
  const [analysisForPath, setAnalysisForPath] = useState<string | null>(null);
  const selectedAudioObjectPath =
    sourceType === CreateJobRequestAudioSourceType.upload
      ? objectPath
      : sourceType === CreateJobRequestAudioSourceType.suno
        ? (sunoResolved?.objectPath ?? null)
        : null;
  const analyzedDurationSec = (analyzeAudio.data as { durationSeconds?: number | null } | undefined)?.durationSeconds;
  const hasCurrentAudioAnalysis =
    !!selectedAudioObjectPath &&
    analysisForPath === selectedAudioObjectPath &&
    analyzeAudio.isSuccess &&
    typeof analyzedDurationSec === "number" &&
    Number.isFinite(analyzedDurationSec) &&
    analyzedDurationSec > 0;
  const fullTrackSelected = String(requestedDuration) === "full";
  const fullTrackNeedsAnalysis =
    fullTrackSelected &&
    sourceType !== CreateJobRequestAudioSourceType.none &&
    !hasCurrentAudioAnalysis;
  const isCurrentAudioAnalysisPending =
    !!selectedAudioObjectPath &&
    analysisForPath === selectedAudioObjectPath &&
    analyzeAudio.isPending;
  // Analyzed song length is the authoritative Full track target shown to the
  // user and sent with the job. Never reuse a stale analysis from another file.
  const songDurationSec = hasCurrentAudioAnalysis ? analyzedDurationSec : undefined;
  const fullTrackOverLimit = !!songDurationSec && songDurationSec > MAX_FULL_SECONDS;
  const fullTrackLabel = songDurationSec
    ? `Full track · ${formatDuration(songDurationSec)}`
    : "Full track";

  // Fetch a video storyboard only for video confirmation. Images only is an
  // independent product and never needs the video planning route.
  useEffect(() => {
    if (!confirmOpen) return;
    if (imagePackMode) {
      setShotPlan(null);
      setShotPlanLoading(false);
      return;
    }
    let active = true;
    setShotPlan(null);
    setShotPlanLoading(true);
    fetch("/api/jobs/preview-shots", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        style: selectedStyle,
        generationMode,
        character,
        requestedDuration: effectiveRequestedDuration,
        silentFilmDurationSeconds:
          sourceType === CreateJobRequestAudioSourceType.none ? silentFilmDurationSeconds : null,
        audioObjectPath: selectedAudioObjectPath,
        audioAnalysis:
          analyzeAudio.isSuccess && analysisForPath === selectedAudioObjectPath
            ? analyzeAudio.data
            : null,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (active) setShotPlan(data); })
      .catch(() => {})
      .finally(() => { if (active) setShotPlanLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen, imagePackMode]);
  // Quick-start: apply a template's prompt/style/aspect/duration in one click.
  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    setPrompt(t.prompt);
    setSelectedStyle(t.style);
    setAspectRatio(t.aspect);
    handleDurationChange(t.duration);
    setQuickStartTemplateId(t.id);
    setQuickStartOpen(false);
    setFieldErrors((fe) => ({ ...fe, prompt: undefined }));
  }

  // Platform preset: set aspect ratio + duration for a target in one click.
  function applyPreset(p: (typeof PLATFORM_PRESETS)[number]) {
    setAspectRatio(p.aspect);
    handleDurationChange(p.duration);
    setQuickStartOpen(false);
  }

  const quickStartTemplateLabel = TEMPLATES.find((template) => template.id === quickStartTemplateId)?.label ?? "Choose a template";

  // Trigger server-side analysis as soon as the upload path is available.
  // Reset mutation state immediately when objectPath changes so old badges disappear.
  useEffect(() => {
    if (selectedAudioObjectPath) {
      analyzeAudio.reset();
      setAnalysisForPath(selectedAudioObjectPath);
      analyzeAudio.mutate({ data: { objectPath: selectedAudioObjectPath } });
    } else {
      analyzeAudio.reset();
      setAnalysisForPath(null);
    }
    // analyzeAudio.mutate / analyzeAudio.reset are stable refs — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAudioObjectPath]);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthLoading, isAuthenticated, setLocation]);

  // Deep link from the /suno landing page (or a shared link): ?suno=<url>.
  // Also checks localStorage so the link survives a login/register detour.
  const sunoDeepLinkHandled = useRef(false);
  useEffect(() => {
    if (sunoDeepLinkHandled.current || !isAuthenticated) return;
    const fromQuery = new URLSearchParams(window.location.search).get("suno");
    const fromStorage = localStorage.getItem("pendingSunoUrl");
    const pending = fromQuery || fromStorage;
    if (!pending) return;
    sunoDeepLinkHandled.current = true;
    localStorage.removeItem("pendingSunoUrl");
    setSourceType(CreateJobRequestAudioSourceType.suno);
    setSunoInputUrl(pending);
    setSunoAutoResolve(true);
  }, [isAuthenticated]);

  const handleSunoResolve = useCallback(async () => {
    if (!sunoInputUrl.trim() || sunoResolving) return;
    setSunoResolving(true);
    setSunoError(null);
    setSunoResolved(null);
    try {
      const res = await fetch(`/api/suno/resolve?url=${encodeURIComponent(sunoInputUrl)}`);
      const data = await res.json() as { audioUrl?: string; title?: string; artist?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load track");
      const importRes = await fetch("/api/audio/import-from-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sunoInputUrl, title: data.title ?? "Untitled" }),
      });
      const imported = await importRes.json() as { objectPath?: string; error?: string };
      if (!importRes.ok || !imported.objectPath) {
        throw new Error(imported.error ?? "Failed to import track");
      }
      setSunoResolved({
        audioUrl: data.audioUrl!,
        title: data.title ?? "Untitled",
        artist: data.artist ?? "",
        objectPath: imported.objectPath,
      });
      setFieldErrors((fe) => ({ ...fe, audio: undefined }));
    } catch (err) {
      setSunoError(err instanceof Error ? err.message : "Could not load track");
    } finally {
      setSunoResolving(false);
    }
  }, [sunoInputUrl, sunoResolving]);

  // Auto-resolve a deep-linked Suno URL once it's been set in state.
  useEffect(() => {
    if (sunoAutoResolve && sunoInputUrl.trim() && !sunoResolving) {
      setSunoAutoResolve(false);
      void handleSunoResolve();
    }
  }, [sunoAutoResolve, sunoInputUrl, sunoResolving, handleSunoResolve]);

  if (isAuthLoading) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-10 space-y-6">
        <div className="h-8 w-48 rounded-lg bg-secondary/50 animate-pulse" />
        <div className="h-4 w-72 rounded bg-secondary/40 animate-pulse" />
        <div className="h-48 rounded-2xl bg-secondary/30 animate-pulse mt-6" />
        <div className="h-32 rounded-2xl bg-secondary/30 animate-pulse" />
        <div className="h-12 w-40 rounded-xl bg-secondary/40 animate-pulse" />
      </div>
    );
  }

  if (!isAuthenticated) return <SignupTeaser variant="generate" />;

  const isAdmin = user?.isAdmin ?? false;
  const subStatus = user?.subscriptionStatus ?? "none";
  const canCreate = isAdmin || subStatus === "active";

  if (!canCreate) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="max-w-md w-full text-center space-y-6 relative z-10">
          <div className="flex justify-center">
            <div className="h-20 w-20 rounded-2xl bg-gradient-electric shadow-glow flex items-center justify-center">
              <Lock className="h-10 w-10 text-white" />
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight mb-3">
              Unlock <span className="text-gradient-electric">AI video generation</span>
            </h2>
            <p className="text-muted-foreground text-lg">
              An active subscription lets you turn any track into a beat-synced music video.
            </p>
          </div>
          <div className="rounded-2xl border border-primary/20 bg-card/60 backdrop-blur p-6 text-left space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Crown className="h-4 w-4 text-primary shrink-0" />
              <span>Unlimited AI music video generations</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <span>All visual styles and aspect ratios</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Zap className="h-4 w-4 text-primary shrink-0" />
              <span>Priority processing queue</span>
            </div>
          </div>
          <Link href="/pricing" className="w-full">
            <Button
              size="lg"
              className="w-full bg-gradient-electric text-white shadow-glow text-base hover:opacity-90 transition-opacity"
            >
              <Crown className="mr-2 h-5 w-5" />
              View Plans
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground">
            Contact support if you believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  // Cost + affordability for the current selection — computed once here so
  // both the pre-submit guard in handleGenerate and the render below share
  // the exact same numbers (no duplicated inline logic).
  // Karaoke lyric burn is a paid add-on — mirror of the server-side charge
  // (jobs.ts adds LYRIC_OVERLAY_COST when lyrics are present). Every price
  // surface on this page must include it so the shown cost equals the charge.
  const effectiveRequestedDuration =
    sourceType === CreateJobRequestAudioSourceType.none
      ? String(silentFilmDurationSeconds) as CreateJobRequestRequestedDuration
      : requestedDuration;
  const lyricAddon = lyricsText.trim() ? LYRIC_OVERLAY_COST : 0;
  const generatedImageCost = estimateGeneratedImageCost(
    effectiveRequestedDuration,
    songDurationSec,
    generationMode as GenerationMode,
    narrativeVisualSource === CreateJobRequestNarrativeVisualSource.generated_images ? "generated_images" : "video",
  );
  const videoAnimationCost =
    estimateCreditCost(effectiveRequestedDuration, aiProvider, resolution, songDurationSec, generationMode as GenerationMode);
  const videoCost =
    videoAnimationCost
    + generatedImageCost
    + lyricAddon;
  const lipSyncAddon =
    fullTrackSelected && fullTrackLipSyncEnabled
      ? calculateLipsyncCost(fullTrackLipSyncSeconds)
      : 0;
  const cost = videoCost + lipSyncAddon;
  const imagePackCost = imagePackCount * GENERATED_IMAGE_CREDITS_PER_VISUAL;
  const activeCost = imagePackMode ? imagePackCost : cost;
  const generationEstimate = getGenerationTimeEstimate(
    effectiveRequestedDuration,
    aiProvider,
    resolution,
    songDurationSec,
    generationMode as GenerationMode
  );
  const balance = statsData?.creditsRemaining ?? null;
  const canAfford = canAffordCredits(activeCost, balance, isAdmin);

  const characterLabel = CHARACTERS.find((c) => c.value === character)?.label ?? "None";

  // Auto-sync lyrics against the audio source (2 credits).
  // Upload tab: uses the stored objectPath directly.
  // Suno tab: imports the resolved streaming URL to object storage first (cached
  //           on sunoResolved.objectPath so repeat clicks don't re-import).
  const canAutoSync =
    sourceType === CreateJobRequestAudioSourceType.upload
      ? !!objectPath
      : sourceType === CreateJobRequestAudioSourceType.suno
        ? !!sunoResolved
        : false;

  const autoSyncLyrics = async () => {
    if (!canAutoSync || lyricsSyncing) return;
    setLyricsSyncing(true);
    setLyricsSyncNote(null);
    try {
      let audioObjectPath: string | null = null;

      if (sourceType === CreateJobRequestAudioSourceType.upload) {
        audioObjectPath = objectPath;
      } else if (sourceType === CreateJobRequestAudioSourceType.suno && sunoResolved) {
        // Use cached objectPath from a prior import, or import now.
        if (sunoResolved.objectPath) {
          audioObjectPath = sunoResolved.objectPath;
        } else {
          setLyricsSyncNote("Importing track… this takes a few seconds.");
          const imp = await fetch("/api/audio/import-from-link", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: sunoResolved.audioUrl }),
          });
          const impData = await imp.json().catch(() => ({}));
          if (!imp.ok) {
            setLyricsSyncNote(impData?.error || "Couldn't import track. Please try again.");
            return;
          }
          audioObjectPath = impData.objectPath as string;
          // Cache so the next Auto-sync click skips the import — but only if
          // the resolved track hasn't been swapped while the import ran.
          const importedFor = sunoResolved.audioUrl;
          setSunoResolved((prev) =>
            prev && prev.audioUrl === importedFor ? { ...prev, objectPath: audioObjectPath! } : prev,
          );
        }
        setLyricsSyncNote(null);
      }

      if (!audioObjectPath) {
        setLyricsSyncNote("No audio source found — upload a track or load a Suno link.");
        return;
      }

      const res = await fetch(`/api/lyrics/align`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioObjectPath,
          lyricsText: lyricsText.trim() || undefined,
          acceptCopyright: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLyricsSyncNote(data?.error || "Auto-sync failed. Please try again.");
        return;
      }
      if (typeof data?.lrc === "string" && data.lrc.trim()) {
        setLyricsText(data.lrc);
        setLyricsSyncNote(
          data.lrc.length > MAX_LYRICS_LENGTH
            ? `Auto-sync produced ${data.lrc.length.toLocaleString()} characters. Shorten the lyrics to ${MAX_LYRICS_LENGTH.toLocaleString()} characters before generating.`
            : data?.source === "asr"
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

  const submitJob = () => {
    if (imagePackMode) {
      void submitImagePack();
      return;
    }
    if (
      lyricsEnabled &&
      lyricsText.trim().length > MAX_LYRICS_LENGTH
    ) {
      setConfirmOpen(false);
      setErrorDialog({
        open: true,
        title: "Lyrics are too long",
        message: `Shorten the lyrics to ${MAX_LYRICS_LENGTH.toLocaleString()} characters or fewer, then try again.`,
      });
      return;
    }
    if (fullTrackNeedsAnalysis || fullTrackOverLimit) {
      const message = fullTrackOverLimit
        ? `Full-track videos support audio up to ${Math.floor(MAX_FULL_SECONDS / 60)} minutes. Choose a shorter track or a specific duration.`
        : isCurrentAudioAnalysisPending
          ? "Audio analysis is still running. Wait for it to finish before creating a full-track video."
          : "Audio analysis did not finish. Retry the analysis or choose a specific video duration.";
      setConfirmOpen(false);
      setFieldErrors((errors) => ({ ...errors, audio: message }));
      setErrorDialog({
        open: true,
        title: fullTrackOverLimit ? "Track is too long" : "Audio analysis not ready",
        message,
        code: fullTrackOverLimit
          ? "AUDIO_DURATION_LIMIT_EXCEEDED"
          : "AUDIO_ANALYSIS_REQUIRED",
      });
      return;
    }
    setConfirmOpen(false);
    createJob.mutate(
      {
        data: {
          prompt,
          style: selectedStyle,
          audioSourceType: sourceType,
          audioObjectPath:
            sourceType === CreateJobRequestAudioSourceType.none ? null : selectedAudioObjectPath,
          audioSourceUrl:
            sourceType === CreateJobRequestAudioSourceType.suno ? (sunoResolved?.audioUrl ?? null) : null,
          lyricsText: lyricsEnabled && lyricsText.trim() ? lyricsText.trim() : null,
          aspectRatio,
          resolution,
          character: character !== "none" ? character : null,
          referenceImagePath: refImageObjectPath ?? null,
          requestedDuration: effectiveRequestedDuration,
          silentFilmDurationSeconds:
            sourceType === CreateJobRequestAudioSourceType.none ? silentFilmDurationSeconds : null,
          generationMode,
          narrativeVisualSource,
          aiProvider,
          fullTrackLipSyncEnabled: fullTrackSelected && fullTrackLipSyncEnabled,
          fullTrackLipSyncSeconds,
          fullTrackLipSyncStartTime: clipStartTime,
          fullTrackLipSyncImagePath:
            fullTrackSelected && fullTrackLipSyncEnabled ? lipSyncImageObjectPath : null,
          clipStartTime:
            sourceType === CreateJobRequestAudioSourceType.upload &&
            !fullTrackSelected &&
            clipStartTime > 0
              ? clipStartTime
              : null,
          audioAnalysis:
            sourceType !== CreateJobRequestAudioSourceType.none &&
            hasCurrentAudioAnalysis &&
            analyzeAudio.data
              ? {
                  ...analyzeAudio.data,
                }
              : null,
          // Copyright/ownership attestation (gated by the checkbox above) —
          // not applicable to a silent "no audio" render, so it's implicitly
          // satisfied for that mode.
          acceptCopyright:
            sourceType === CreateJobRequestAudioSourceType.none ? true : copyrightAcknowledged,
        } as unknown as CreateJobRequest,
      },
      {
        onSuccess: (job) => setLocation(`/jobs/${job.id}`),
        onError: async (err: unknown) => {
          let title = "Generation failed";
          let message = "Something went wrong. Please try again.";
          let code: string | undefined;
          let creditsRequired: number | undefined;
          let creditsRemaining: number | undefined;

          try {
            const res = (err as { response?: Response })?.response;
            if (res) {
              const body = await res.clone().json().catch(() => null);
              if (body) {
                message = body.error ?? message;
                code = body.code;
                creditsRequired = body.creditsRequired;
                creditsRemaining = body.creditsRemaining;
              }
            } else {
              message = (err as { message?: string })?.message ?? message;
            }
          } catch {
            message = (err as { message?: string })?.message ?? message;
          }

          if (code === "INSUFFICIENT_CREDITS") title = "Not enough credits";
          else if (code === "SUBSCRIPTION_REQUIRED") title = "Subscription required";
          else if (code === "AUDIO_ANALYSIS_REQUIRED") {
            title = "Audio analysis not ready";
            message = "Audio analysis did not finish. Retry the analysis or choose a specific video duration.";
          } else if (code === "AUDIO_DURATION_LIMIT_EXCEEDED") {
            title = "Track is too long";
          }

          setErrorDialog({ open: true, title, message, code, creditsRequired, creditsRemaining });
        },
      },
    );
  };

  const submitImagePack = async () => {
    if (!Number.isInteger(imagePackCount) || imagePackCount < 1 || imagePackCount > 30) {
      setConfirmOpen(false);
      setErrorDialog({
        open: true,
        title: "Choose an image count",
        message: "Image packs can contain between 1 and 30 images.",
      });
      return;
    }
    setConfirmOpen(false);
    setImagePackSubmitting(true);
    try {
      const response = await fetch("/api/image-packs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          style: selectedStyle,
          imageCount: imagePackCount,
          aspectRatio: imagePackAspectRatio,
          referenceImagePath: refImageObjectPath ?? null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorDialog({
          open: true,
          title: body.code === "INSUFFICIENT_CREDITS" ? "Not enough credits" : "Image pack unavailable",
          message: body.error ?? "Could not start the image pack. Please try again.",
          code: body.code,
          creditsRequired: body.creditsRequired,
          creditsRemaining: body.creditsRemaining,
        });
        return;
      }
      setLocation(`/jobs/${body.id}`);
    } catch {
      setErrorDialog({
        open: true,
        title: "Image pack unavailable",
        message: "A network error prevented the image pack from starting. No job was created.",
      });
    } finally {
      setImagePackSubmitting(false);
    }
  };

  const handleGenerate = () => {
    const errors: {
      prompt?: string;
      audio?: string;
      lipSync?: string;
      lyrics?: string;
    } = {};

    if (!prompt.trim()) {
      errors.prompt = "Please describe the visuals you want.";
    }
    if (imagePackMode && (!Number.isInteger(imagePackCount) || imagePackCount < 1 || imagePackCount > 30)) {
      errors.prompt = "Choose between 1 and 30 images for this pack.";
    }
    if (!imagePackMode && sourceType === CreateJobRequestAudioSourceType.upload && !objectPath) {
      errors.audio = isUploading ? "Still uploading — wait a moment." : "Please upload an audio file.";
    }
    if (!imagePackMode && sourceType === CreateJobRequestAudioSourceType.suno && !sunoResolved) {
      errors.audio = sunoResolving ? "Loading track — wait a moment." : "Please load a Suno track first.";
    }
    if (
      !imagePackMode && sourceType === CreateJobRequestAudioSourceType.none
      && (!Number.isInteger(silentFilmDurationSeconds) || silentFilmDurationSeconds < 5 || silentFilmDurationSeconds > MAX_FULL_SECONDS)
    ) {
      errors.audio = `Choose a silent-film length between 5 and ${MAX_FULL_SECONDS} seconds.`;
    }
    if (!imagePackMode && fullTrackNeedsAnalysis) {
      errors.audio = "Wait for audio analysis to finish before creating a full-track video.";
    }
    if (!imagePackMode && requestedDuration === CreateJobRequestRequestedDuration.full && fullTrackOverLimit) {
      errors.audio = `Full-track videos support audio up to ${Math.floor(MAX_FULL_SECONDS / 60)} minutes. Choose a shorter track or a specific duration.`;
    }
    if (
      !imagePackMode && fullTrackSelected &&
      fullTrackLipSyncEnabled &&
      (!lipSyncImageObjectPath || isUploadingLipSyncImage)
    ) {
      errors.lipSync = isUploadingLipSyncImage
        ? "Wait for the face image to finish uploading."
        : "Upload a face image for the bundled AI Lip Sync video.";
    }
    if (
      lyricsEnabled &&
      lyricsText.trim().length > MAX_LYRICS_LENGTH
    ) {
      errors.lyrics = `Shorten the lyrics to ${MAX_LYRICS_LENGTH.toLocaleString()} characters or fewer.`;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      if (errors.audio) {
        audioSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (errors.prompt) {
        promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        promptRef.current?.focus();
      }
      return;
    }

    setFieldErrors({});

    // Proactive credit check — use the compounded video + Lip Sync total.
    if (!canAfford) {
      setTopUpOpen(true);
      return;
    }

    const durSec = effectiveRequestedDuration === CreateJobRequestRequestedDuration.full
      ? null
      : parseInt(effectiveRequestedDuration as string, 10);

    if (durSec !== null && durSec >= 90) {
      setDurationWarningOpen(true);
      return;
    }

    setConfirmOpen(true);
  };

  return (
    <>
    <div className="container mx-auto px-4 py-6 sm:py-12 max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6 sm:space-y-8"
      >
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-3">
            <Sparkles className="h-3.5 w-3.5" />
            AI Generator
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-2">
            Create a <span className="text-gradient-electric">new video</span>
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-xl">
            Drop in a track — our AI reads its beat, energy, and mood, then generates a cinematic, beat-synced music video.
          </p>
        </div>

        <TutorialTip id="generate" title="Making a video">
          Add audio (upload, Suno link, or one of your Soundtracks), describe the look, pick your engine — <strong>Runway</strong> (premium)
          or <strong>Kling</strong> (value) — and a length. We charge credits only when it succeeds.
        </TutorialTip>

        {/* ── Quick start: a compact mobile picker, full controls on larger screens ── */}
        <div className="sm:hidden rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/[0.09] to-accent/[0.06] p-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex flex-1 items-center gap-2 max-[359px]:hidden">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-4">Quick start</p>
                <p className="truncate text-xs text-muted-foreground">Start from a ready-made look</p>
              </div>
            </div>
            <Link href="/soundtracks" aria-label="Create a song">
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0">
                <Music className="h-4 w-4" />
              </Button>
            </Link>
            <Popover open={quickStartOpen} onOpenChange={setQuickStartOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-9 max-w-[8.75rem] min-w-0 shrink-0 justify-between gap-1.5 border-primary/35 bg-primary/10 px-2.5 text-xs font-semibold text-primary">
                  <span className="truncate">{quickStartTemplateLabel}</span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${quickStartOpen ? "rotate-180" : ""}`} />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} className="w-[calc(100vw-2rem)] max-w-sm p-2">
                <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Choose a starting point</p>
                <div className="grid grid-cols-2 gap-1">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="min-w-0 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-secondary"
                    >
                      <span className="block truncate text-xs font-medium">{t.label}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{t.style} · {t.duration}s</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 border-t border-border/60 pt-2">
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Output size</p>
                  <div className="grid grid-cols-2 gap-1">
                    {PLATFORM_PRESETS.map((p) => {
                      const active = aspectRatio === p.aspect && requestedDuration === p.duration;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyPreset(p)}
                          className={`rounded-lg px-2 py-2 text-left text-xs transition-colors ${
                            active ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="hidden sm:block rounded-2xl border border-border/60 bg-background/30 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> Quick start
            </span>
            <Link href="/soundtracks">
              <Button variant="outline" size="sm">
                <Music className="mr-1.5 h-3.5 w-3.5" /> Create a Song
              </Button>
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className="inline-flex items-center rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-secondary/70"
              >
                <span className="mr-1">{t.emoji}</span>
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Templates fill in a prompt, style, aspect ratio, and length — tweak anything after.
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Need narration for your video too?{" "}
            <a href="https://aipodsync.com" className="text-primary font-medium hover:underline">
              Narrate your videos on AIPodSync
            </a>
            .
          </p>
          <div className="mt-4 border-t border-border/40 pt-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Sized for</div>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_PRESETS.map((p) => {
                const active = aspectRatio === p.aspect && requestedDuration === p.duration;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/60 bg-secondary/40 hover:border-primary/40 hover:bg-secondary/70"
                    }`}
                  >
                    <span className="mr-1">{p.emoji}</span>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <Collapsible open={imagePackMode} onOpenChange={setImagePackMode}>
          <section
            aria-labelledby="images-only-heading"
            className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] via-card to-accent/[0.045] p-4 shadow-lg sm:p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span id="images-only-heading">Images only</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="rounded-full text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        aria-label="About Images only"
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
                      You only need a prompt to create an image pack. No audio track, video upload, or video render is required.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Generate a standalone pack of reusable stills without audio or video rendering.
                </p>
              </div>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant={imagePackMode ? "default" : "outline"}
                  data-testid="toggle-image-pack-mode"
                  aria-label={imagePackMode ? "Hide Images only options and return to video generation" : "Show Images only options"}
                >
                  {imagePackMode ? "Images only enabled" : "Images only"}
                  <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${imagePackMode ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div className="mt-4 grid gap-4 border-t border-primary/15 pt-4 sm:grid-cols-[minmax(0,1fr)_150px_220px] sm:items-end">
                <div>
                  <Label htmlFor="image-pack-count">Images to generate</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Each image costs {GENERATED_IMAGE_CREDITS_PER_VISUAL} credits. Failed images are refunded.
                  </p>
                </div>
                <div>
                  <Input
                    id="image-pack-count"
                    type="number"
                    min={1}
                    max={30}
                    value={imagePackCount}
                    onChange={(event) => setImagePackCount(Number(event.target.value))}
                    aria-label="Images to generate"
                  />
                  <p className="mt-1 text-right text-xs font-medium text-primary">
                    {imagePackCost} credits
                  </p>
                </div>
                <div>
                  <Label>Image size</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Image size">
                    {([
                      ["9:16", "Portrait"],
                      ["16:9", "Landscape"],
                    ] as const).map(([ratio, label]) => {
                      const selected = imagePackAspectRatio === ratio;
                      return (
                        <button
                          key={ratio}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setImagePackAspectRatio(ratio)}
                          className={`rounded-lg border px-2 py-2 text-left text-xs font-medium transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background hover:border-primary/50"
                          }`}
                        >
                          <span className="block">{ratio}</span>
                          <span className="text-[10px] font-normal text-muted-foreground">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>

        <div className="grid gap-5 sm:gap-8 p-4 sm:p-8 rounded-2xl bg-card border border-card-border shadow-lg">

          <div className={`space-y-2 ${imagePackMode ? "hidden" : ""}`}>
            <Label>Video structure</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setGenerationMode(CreateJobRequestGenerationMode.montage)}
                aria-pressed={generationMode === CreateJobRequestGenerationMode.montage}
                className={`text-left rounded-xl border p-3.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  generationMode === CreateJobRequestGenerationMode.montage
                    ? "border-primary/50 bg-primary/[0.08] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.08)]"
                    : "border-border/60 bg-muted/20 hover:border-primary/30"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      generationMode === CreateJobRequestGenerationMode.montage
                        ? "bg-primary/15 text-primary"
                        : "bg-secondary text-muted-foreground"
                    }`}>
                      <Clapperboard className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">Visual Montage</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Creates a focused set of visuals, then edits and recalls them across the track to keep the cost lower.
                      </p>
                    </div>
                  </div>
                  {generationMode === CreateJobRequestGenerationMode.montage && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Selected
                    </span>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setGenerationMode(CreateJobRequestGenerationMode.narrative)}
                aria-pressed={generationMode === CreateJobRequestGenerationMode.narrative}
                className={`text-left rounded-xl border p-3.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  generationMode === CreateJobRequestGenerationMode.narrative
                    ? "border-primary/50 bg-primary/[0.08] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.08)]"
                    : "border-border/60 bg-muted/20 hover:border-primary/30"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      generationMode === CreateJobRequestGenerationMode.narrative
                        ? "bg-primary/15 text-primary"
                        : "bg-secondary text-muted-foreground"
                    }`}>
                      <FileText className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">Narrative Story</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        A chronological beginning-to-ending story with a unique scene for each timeline segment. No visual recalls.
                      </p>
                    </div>
                  </div>
                  {generationMode === CreateJobRequestGenerationMode.narrative && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Selected
                    </span>
                  )}
                </div>
              </button>
            </div>
            <div className="mt-3 rounded-xl border border-primary/20 bg-primary/[0.035] p-3.5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <ImageIcon className="h-4 w-4" />
                </span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Image foundation included</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {generationMode === CreateJobRequestGenerationMode.narrative
                          ? "First creates one ordered story image for every scene, then animates each segment from its matching image."
                          : "First creates a consistent motif image pack, then animates every montage segment from its assigned image."}
                      </p>
                    </div>
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Automatic
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Settings Toolbar ── */}
          <div className={`rounded-xl border border-border/60 bg-background/40 overflow-hidden ${imagePackMode ? "hidden" : ""}`}>
            {/* Top bar */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-background/20">
              <span className="text-xs text-muted-foreground font-medium">Video Settings</span>
              <Maximize2 className="h-3.5 w-3.5 text-muted-foreground/50" />
            </div>

            {/* Pill row — scrollable on mobile, wraps on larger screens */}
            <div className="flex items-center gap-1.5 px-3 py-2 flex-wrap overflow-x-auto scrollbar-none">

              {/* Character */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 hover:bg-secondary/70 px-3 py-1.5 text-sm font-medium transition-colors">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{characterLabel}</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  {CHARACTERS.map((c) => (
                    <DropdownMenuItem
                      key={c.value}
                      onClick={() => setCharacter(c.value)}
                      className={character === c.value ? "text-primary font-medium" : ""}
                    >
                      {c.label}
                    </DropdownMenuItem>
                  ))}
                  <div className="px-2 pt-1 pb-1.5">
                    <p className="text-[10px] text-muted-foreground/60 leading-tight">
                      Who's on screen. Add a reference image below to lock the same character across every clip.
                    </p>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="hidden sm:block h-5 w-px bg-border/40 mx-0.5" />

              {/* AI provider */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 hover:bg-secondary/70 px-3 py-1.5 text-sm font-medium transition-colors">
                    <Wand2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{PROVIDER_LABELS[aiProvider]}</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {(["runway", "kling"] as const).map((p) => (
                    <DropdownMenuItem
                      key={p}
                      onClick={() => setAiProvider(p)}
                      className={`flex items-center justify-between gap-3 ${aiProvider === p ? "text-primary font-medium" : ""}`}
                    >
                      <span>
                        {PROVIDER_LABELS[p]}
                        <span className="text-muted-foreground"> · {p === "runway" ? "premium quality" : "value price"}</span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">{estimateCreditCost(effectiveRequestedDuration, p, resolution, songDurationSec, generationMode as GenerationMode) + lyricAddon} cr</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="hidden sm:block h-5 w-px bg-border/40 mx-0.5" />

              {/* Duration */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 hover:bg-secondary/70 px-3 py-1.5 text-sm font-medium transition-colors">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{
                       sourceType === CreateJobRequestAudioSourceType.none ? `Silent · ${formatDuration(silentFilmDurationSeconds)}`
                         : requestedDuration === CreateJobRequestRequestedDuration.full ? fullTrackLabel
                        : (requestedDuration as string) === "300" ? "5 min"
                        : (requestedDuration as string) === "600" ? "10 min"
                        : `${durationToSeconds(requestedDuration)}s`
                    }</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuItem
                    disabled={
                      sourceType === CreateJobRequestAudioSourceType.none ||
                      !hasCurrentAudioAnalysis ||
                      fullTrackOverLimit
                    }
                    onClick={() => handleDurationChange(CreateJobRequestRequestedDuration.full)}
                    className={`flex items-center justify-between gap-3 ${
                      requestedDuration === CreateJobRequestRequestedDuration.full ? "text-primary font-medium" : ""
                    }`}
                    data-testid="duration-full-track"
                  >
                    <span>{fullTrackLabel}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {estimateCreditCost(CreateJobRequestRequestedDuration.full, aiProvider, resolution, songDurationSec, generationMode as GenerationMode) + lyricAddon} cr
                    </span>
                  </DropdownMenuItem>
                  {([
                    { value: CreateJobRequestRequestedDuration.NUMBER_5, label: "5 seconds" },
                    { value: CreateJobRequestRequestedDuration.NUMBER_10, label: "10 seconds" },
                    { value: CreateJobRequestRequestedDuration.NUMBER_30, label: "30 seconds" },
                    { value: CreateJobRequestRequestedDuration.NUMBER_45, label: "45 seconds" },
                    { value: CreateJobRequestRequestedDuration.NUMBER_60, label: "60 seconds" },
                    { value: CreateJobRequestRequestedDuration.NUMBER_90, label: "90 seconds" },
                     { value: CreateJobRequestRequestedDuration.NUMBER_120, label: "120 seconds" },
                    { value: CreateJobRequestRequestedDuration.NUMBER_300, label: "5 minutes" },
                    { value: CreateJobRequestRequestedDuration.NUMBER_600, label: "10 minutes" },
                  ] as const).map(({ value, label }) => {
                    const base = estimateCreditCost(value, aiProvider, resolution, songDurationSec, generationMode as GenerationMode) + lyricAddon;
                    return (
                      <DropdownMenuItem
                        key={value}
                        onClick={() => handleDurationChange(value)}
                        className={`flex items-center justify-between gap-3 ${requestedDuration === value ? "text-primary font-medium" : ""}`}
                      >
                        <span>{label}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {base.toLocaleString()} cr
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                  <div className="px-2 pt-1 pb-1.5">
                    <p className="text-[10px] text-muted-foreground/60 leading-tight">
                      Full track matches your analyzed audio exactly (up to 10 minutes). Longer videos use more{" "}
                      {generationMode === CreateJobRequestGenerationMode.narrative ? "unique scenes" : "visuals"} and take more time to generate.
                    </p>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="hidden sm:block h-5 w-px bg-border/40 mx-0.5" />

              {/* Aspect Ratio */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 hover:bg-secondary/70 px-3 py-1.5 text-sm font-medium transition-colors">
                    <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{aspectRatio}</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-28">
                  {ASPECT_RATIOS.map((r) => (
                    <DropdownMenuItem
                      key={r}
                      onClick={() => setAspectRatio(r)}
                      className={aspectRatio === r ? "text-primary font-medium" : ""}
                    >
                      {r}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Resolution */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 hover:bg-secondary/70 px-3 py-1.5 text-sm font-medium transition-colors">
                    <MonitorPlay className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{RES_LABELS[resolution as string] ?? resolution}</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {RESOLUTIONS.map((r) => {
                    const is4k = (r as string) === "4k";
                    const locked = is4k && !can4k;
                    return (
                      <DropdownMenuItem
                        key={r}
                        disabled={locked}
                        onClick={() => {
                          if (locked) return;
                          setResolution(r);
                        }}
                        className={`flex items-center justify-between gap-2 ${resolution === r ? "text-primary font-medium" : ""}`}
                      >
                        <span>{RES_LABELS[r as string] ?? r}</span>
                        {is4k && (
                          <span className="text-[10px] text-muted-foreground">{locked ? "Pro/Studio" : "×5"}</span>
                        )}
                        {(r as string) === "1080p" && (
                          <span className="text-[10px] text-muted-foreground">×1.25</span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                  <div className="px-2 pt-1 pb-1.5">
                    <p className="text-[10px] text-muted-foreground/60 leading-tight">
                      ×1.25 / ×5 is the credit cost vs 720p. 4K needs a Pro or Studio plan.
                    </p>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="hidden sm:block h-5 w-px bg-border/40 mx-0.5" />

              {/* Style */}
              <button
                onClick={() => styleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
                className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 hover:bg-secondary/70 px-3 py-1.5 text-sm font-medium transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Style</span>
              </button>

              {/* Captions */}
              <button
                onClick={() => setLyricsEnabled((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  lyricsEnabled
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/50 bg-secondary/40 hover:bg-secondary/70"
                }`}
              >
                <Captions className="h-3.5 w-3.5" />
                <span>Captions</span>
              </button>

              {/* Spacer + Edit prompt */}
              <div className="ml-auto">
                <button
                  onClick={() => document.getElementById("prompt")?.focus()}
                  className="flex items-center justify-center h-8 w-8 rounded-lg border border-border/50 bg-secondary/40 hover:bg-secondary/70 transition-colors"
                  title="Edit prompt"
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>

          {/* ── Audio Source ── */}
          <div ref={audioSectionRef} className={imagePackMode ? "hidden" : undefined}>
          <Tabs
            value={sourceType}
            onValueChange={(v) => {
              const next = v as CreateJobRequestAudioSourceType;
              setSourceType(next);
              setFieldErrors((e) => ({ ...e, audio: undefined }));
              // No audio to derive a "full length" from — force a concrete duration.
              if (next === CreateJobRequestAudioSourceType.none && requestedDuration === CreateJobRequestRequestedDuration.full) {
                setRequestedDuration(CreateJobRequestRequestedDuration.NUMBER_30);
              }
            }}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger
                value={CreateJobRequestAudioSourceType.upload}
                className="flex items-center gap-1.5 text-xs sm:text-sm"
              >
                <Upload className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                <span>Audio</span>
              </TabsTrigger>
              <TabsTrigger
                value={CreateJobRequestAudioSourceType.suno}
                className="flex items-center gap-1.5 text-xs sm:text-sm"
              >
                <MonitorPlay className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-[#1DB954]" />
                <span>Suno</span>
              </TabsTrigger>
              <TabsTrigger
                value={CreateJobRequestAudioSourceType.none}
                className="flex items-center gap-1.5 text-xs sm:text-sm"
              >
                <VideoOff className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                <span>No audio</span>
              </TabsTrigger>
            </TabsList>

            <div className="mb-6 -mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="hidden sm:inline">or</span>
              <SoundtrackPickerDialog
                onSelect={(t) => {
                  setSourceType(CreateJobRequestAudioSourceType.upload);
                  setObjectPath(t.objectPath);
                  setUploadedFileName(t.title);
                  setFieldErrors((e) => ({ ...e, audio: undefined }));
                }}
              >
                <Button type="button" variant="outline" size="sm">
                  <Music className="mr-1.5 h-4 w-4 text-primary" /> Use one of your Soundtracks
                </Button>
              </SoundtrackPickerDialog>
            </div>

            <TabsContent value={CreateJobRequestAudioSourceType.upload} className="mt-0 space-y-4">
              {/* Hidden native file input */}
              <input
                ref={fileInputRef}
                type="file"
                 accept="audio/*,video/mp4,.mp3,.mp4,.wav,.flac,.ogg,.m4a,.aac"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                  e.target.value = "";
                }}
              />

              {/* ── Drop zone — shown when no file AND no pre-loaded track ── */}
              {!uploadedFile && !objectPath ? (
                <div
                  className="border-2 border-dashed rounded-xl p-5 sm:p-8 flex flex-col items-center justify-center text-center transition-colors cursor-pointer border-border hover:border-primary/50 hover:bg-primary/5"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                >
                  <div className="flex flex-col items-center gap-3 sm:gap-4">
                    <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-full bg-secondary flex items-center justify-center">
                      <Music className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-base sm:text-lg">Drop your audio here</p>
                      <p className="text-sm text-muted-foreground mt-1">or click to browse files</p>
                       <p className="text-xs text-muted-foreground/60 mt-1">MP3, MP4, WAV, FLAC, AAC · up to 50 MB</p>
                    </div>
                    {uploadError && (
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <XCircle className="h-4 w-4" />
                        {uploadError}
                      </div>
                    )}
                    <Button type="button" variant="outline" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                      <Upload className="h-4 w-4 mr-2" />
                      Choose file
                    </Button>
                  </div>
                </div>
              ) : (
                /* ── Compact file strip — shown while uploading or after upload ── */
                <div className="rounded-xl border border-border/60 bg-background/40 overflow-hidden">
                  {/* Progress bar sits at very top, invisible when done */}
                  {isUploading && (
                    <div className="h-1 bg-secondary">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${objectPath ? "bg-green-500/15" : "bg-primary/10"}`}>
                      {isUploading
                        ? <Loader2 className="h-4 w-4 text-primary animate-spin" />
                        : objectPath
                          ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                          : <XCircle className="h-4 w-4 text-destructive" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{uploadedFileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {isUploading
                          ? `Uploading in background… ${uploadProgress}%`
                          : objectPath
                            ? "Ready to generate"
                            : uploadError ?? "Upload failed"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setObjectPath(null);
                        setUploadedFileName(null);
                        setUploadedFile(null);
                        setClipStartTime(0);
                        setFullTrackLipSyncEnabled(false);
                        setLipSyncImageObjectPath(null);
                        if (lipSyncImagePreviewUrl) URL.revokeObjectURL(lipSyncImagePreviewUrl);
                        setLipSyncImagePreviewUrl(null);
                        setLipSyncImageError(null);
                        setUploadError(null);
                      }}
                    >
                      Change
                    </Button>
                  </div>
                </div>
              )}

                {/* ── Waveform Clip Selector — Full-track Lip Sync is opt-in. ── */}
                {uploadedFile && (
                <div className="rounded-xl border border-primary/30 bg-background/40 p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-primary mb-3">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span>
                      {fullTrackSelected
                        ? "Lip Sync section"
                        : "Select clip section"}
                    </span>
                    {fullTrackSelected ? (
                      <div className="ml-auto flex items-center gap-2">
                        <Label htmlFor="full-track-lipsync-enabled" className="text-xs font-medium text-muted-foreground">
                          {fullTrackLipSyncEnabled ? "On" : "Off"}
                        </Label>
                        <Switch
                          id="full-track-lipsync-enabled"
                          checked={fullTrackLipSyncEnabled}
                          onCheckedChange={(enabled) => {
                            setFullTrackLipSyncEnabled(enabled);
                            if (!enabled) setClipStartTime(0);
                          }}
                        />
                      </div>
                    ) : (
                      <span className="text-muted-foreground font-normal text-xs sm:ml-auto">
                        Drag to choose your {durationToSeconds(requestedDuration) ?? 10}s window
                      </span>
                    )}
                  </div>
                  {fullTrackSelected && !fullTrackLipSyncEnabled ? (
                    <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-3 text-xs text-muted-foreground">
                      AI Lip Sync is off by default. Turn it on to create a separate performance video automatically after this full-track video is ready.
                    </div>
                  ) : (
                    <>
                      {fullTrackSelected && (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                          <div>
                            <p className="text-xs font-medium text-primary">Lip Sync clip length</p>
                            <p className="text-[11px] text-muted-foreground">Choose any whole-second length from {LIPSYNC_MIN_SECONDS}–{LIPSYNC_MAX_SECONDS} seconds.</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={LIPSYNC_MIN_SECONDS}
                              max={LIPSYNC_MAX_SECONDS}
                              step={1}
                              value={fullTrackLipSyncSeconds}
                              onChange={(event) => {
                                const requested = Number(event.target.value);
                                setFullTrackLipSyncSeconds(
                                  Math.min(Math.max(Math.round(requested || LIPSYNC_DEFAULT_SECONDS), LIPSYNC_MIN_SECONDS), LIPSYNC_MAX_SECONDS),
                                );
                              }}
                              className="h-8 w-16 text-center text-xs tabular-nums"
                              aria-label="Preferred Lip Sync clip length in seconds"
                            />
                            <span className="text-xs text-muted-foreground">sec</span>
                          </div>
                          <input
                            type="range"
                            min={LIPSYNC_MIN_SECONDS}
                            max={LIPSYNC_MAX_SECONDS}
                            step={1}
                            value={fullTrackLipSyncSeconds}
                            onChange={(event) => setFullTrackLipSyncSeconds(Number(event.target.value))}
                            className="w-full accent-primary"
                            aria-label="Preferred Lip Sync clip length"
                          />
                          <p className="w-full text-[11px] text-muted-foreground">
                            AI Lip Sync adds <strong className="text-foreground">{calculateLipsyncCost(fullTrackLipSyncSeconds)} credits</strong>. The combined total is reserved once when you confirm.
                          </p>
                        </div>
                      )}
                      {fullTrackSelected && (
                        <div className="rounded-lg border border-primary/20 bg-background/40 p-3">
                          <input
                            ref={lipSyncImageInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void handleLipSyncImageSelect(file);
                              event.target.value = "";
                            }}
                          />
                          <div className="flex items-center gap-3">
                            {lipSyncImagePreviewUrl ? (
                              <img
                                src={lipSyncImagePreviewUrl}
                                alt="AI Lip Sync face preview"
                                className="h-16 w-16 rounded-lg border border-border object-cover"
                              />
                            ) : (
                              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20">
                                <User className="h-6 w-6 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-foreground">Face image for AI Lip Sync</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                Upload the face that will perform the selected song segment.
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-2"
                                disabled={isUploadingLipSyncImage}
                                onClick={() => lipSyncImageInputRef.current?.click()}
                              >
                                {isUploadingLipSyncImage ? (
                                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Uploading…</>
                                ) : (
                                  <><Upload className="mr-1.5 h-3.5 w-3.5" /> {lipSyncImageObjectPath ? "Change face" : "Upload face"}</>
                                )}
                              </Button>
                            </div>
                          </div>
                          {(lipSyncImageError || fieldErrors.lipSync) && (
                            <p className="mt-2 text-xs text-destructive">
                              {lipSyncImageError ?? fieldErrors.lipSync}
                            </p>
                          )}
                        </div>
                      )}
                      <AudioWaveformSelector
                        file={uploadedFile}
                        clipDurationSec={fullTrackSelected ? fullTrackLipSyncSeconds : (durationToSeconds(requestedDuration) ?? 10)}
                        clipStartTime={clipStartTime}
                        onClipStartTimeChange={setClipStartTime}
                      />
                      {fullTrackSelected && (
                        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                          <span className="font-medium text-primary">Full track stays intact.</span>{" "}
                          After it is ready, we automatically create a separate AI Lip Sync video from this selected range. The original video is unchanged.
                        </div>
                      )}
                    </>
                  )}

                  {/* ── Audio Analysis Badges ── */}
                  <div className="pt-3 border-t border-border/30 mt-1">
                    {analyzeAudio.isPending && analysisForPath === objectPath && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 text-muted-foreground/60 animate-spin shrink-0" />
                        <span className="text-xs text-muted-foreground/60">Analysing audio…</span>
                        {[72, 88, 64, 80].map((w, i) => (
                          <div
                            key={i}
                            className="h-5 rounded-full bg-secondary/60 animate-pulse"
                            style={{ width: w }}
                          />
                        ))}
                      </div>
                    )}
                {uploadedFile && fullTrackSelected && (
                 <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
                   <div className="flex items-center gap-2 font-medium text-primary">
                     <Clock className="h-4 w-4 shrink-0" />
                     {songDurationSec
                       ? `Full track selected · final video will match ${formatDuration(songDurationSec)}`
                       : "Full track selected · analysing audio duration…"}
                   </div>
                   <p className="mt-1 text-xs text-muted-foreground">
                     {generationMode === CreateJobRequestGenerationMode.narrative
                       ? "Unique chronological scenes follow the complete song, and the finished story ends with your audio."
                       : "Visual clips are arranged across the complete song and the finished video ends with your audio."}
                   </p>
                 </div>
               )}

                    {analyzeAudio.isSuccess && analysisForPath === objectPath && analyzeAudio.data && (() => {
                      const r = analyzeAudio.data;
                      const energyPct = Math.round((r.energy ?? 0) * 100);
                      const energyColor =
                        energyPct >= 70 ? "text-orange-400 border-orange-500/30 bg-orange-500/10"
                        : energyPct >= 45 ? "text-primary border-primary/30 bg-primary/10"
                        : "text-sky-400 border-sky-500/30 bg-sky-500/10";
                      const dominant = r.sections && r.sections.length > 0
                        ? r.sections.reduce((a, b) => a.energy > b.energy ? a : b, r.sections[0]!)
                        : null;
                      return (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mr-0.5">
                            AI sees
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/40 px-2.5 py-0.5 text-xs font-medium tabular-nums">
                            <Music className="h-3 w-3 text-muted-foreground" />
                            {Math.round(r.bpm ?? 0)} BPM
                          </span>
                           {typeof r.durationSeconds === "number" && r.durationSeconds > 0 && (
                             <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/40 px-2.5 py-0.5 text-xs font-medium tabular-nums">
                               <Clock className="h-3 w-3 text-muted-foreground" />
                               {formatDuration(r.durationSeconds)} track
                             </span>
                           )}
                          <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/40 px-2.5 py-0.5 text-xs font-medium capitalize">
                            <Sparkles className="h-3 w-3 text-muted-foreground" />
                            {r.mood ?? "—"}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${energyColor}`}>
                            <Zap className="h-3 w-3" />
                            {energyPct}% energy
                          </span>
                          {dominant && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/40 px-2.5 py-0.5 text-xs font-medium capitalize">
                              <Layers className="h-3 w-3 text-muted-foreground" />
                              {dominant.label}-heavy
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    {analyzeAudio.isError && !analyzeAudio.isPending && analysisForPath === objectPath && objectPath && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-amber-500/80">
                        <span className="inline-flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          Audio analysis unavailable. Retry to use Full track, or choose a specific duration.
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            analyzeAudio.reset();
                            setAnalysisForPath(objectPath);
                            analyzeAudio.mutate({ data: { objectPath } });
                          }}
                        >
                          Retry analysis
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value={CreateJobRequestAudioSourceType.suno} className="mt-0">
              <div className="space-y-3">
                <Label htmlFor="suno-url">Suno share link</Label>
                <div className="flex gap-2">
                  <Input
                    id="suno-url"
                    placeholder="https://suno.com/song/..."
                    value={sunoInputUrl}
                    onChange={(e) => {
                      setSunoInputUrl(e.target.value);
                      setSunoResolved(null);
                      setSunoError(null);
                      setFieldErrors((fe) => ({ ...fe, audio: undefined }));
                    }}
                    onBlur={handleSunoResolve}
                    className={`h-12 bg-background/50 ${fieldErrors.audio ? "border-destructive" : "border-input"}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 px-4 shrink-0"
                    onClick={handleSunoResolve}
                    disabled={sunoResolving || !sunoInputUrl.trim()}
                  >
                    {sunoResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load"}
                  </Button>
                </div>
                {sunoResolved && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1DB954]/10 border border-[#1DB954]/30 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-[#1DB954] shrink-0" />
                    <span className="font-medium">{sunoResolved.title}</span>
                    {sunoResolved.artist && (
                      <span className="text-muted-foreground">by {sunoResolved.artist}</span>
                    )}
                  </div>
                )}
                {sunoError && (
                  <p className="flex items-center gap-1.5 text-sm text-destructive">
                    <XCircle className="h-4 w-4 shrink-0" /> {sunoError}
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value={CreateJobRequestAudioSourceType.none} className="mt-0">
              <TutorialTip id="no-audio" title="Score it later — most AI video generators can't do this">
                Render your visuals now with no soundtrack, then add the perfect track once you've found
                it — your own upload, a Suno link, or a generated Soundtrack — right in the Editor's Remix
                Lab. No need to have a song picked out before you start creating.
              </TutorialTip>
              <div className="mt-3 flex items-start gap-3 rounded-xl border border-border/60 bg-background/30 p-4">
                <VideoOff className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Silent video — add music later</p>
                  <p className="text-sm text-muted-foreground">
                    Renders your visuals with no soundtrack. Once it's ready, open it in the Editor
                    (Remix Lab) to add a track — your own upload, a Suno link, or a Soundtrack.
                  </p>
                  <p className="text-sm text-muted-foreground pt-1">
                    Need exact words on screen — a title card or a CTA? Don't type them into the prompt
                    above; the AI will draw them as pixels and often garbles the spelling. Use the{" "}
                    <span className="text-foreground font-medium">On-screen text</span> section below instead
                    — it burns real, crisp text into the video.
                  </p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-border/60 bg-background/30 p-4">
                <Label htmlFor="silent-film-duration" className="text-sm font-medium">
                  Silent-film length
                </Label>
                <div className="mt-2 flex items-center gap-3">
                  <Input
                    id="silent-film-duration"
                    type="number"
                    min={5}
                    max={MAX_FULL_SECONDS}
                    step={1}
                    value={silentFilmDurationSeconds}
                    onChange={(event) => setSilentFilmDurationSeconds(Number(event.target.value))}
                    className="max-w-36"
                    aria-describedby="silent-film-duration-help"
                  />
                  <span className="text-sm text-muted-foreground">seconds · {formatDuration(silentFilmDurationSeconds)}</span>
                </div>
                <p id="silent-film-duration-help" className="mt-2 text-xs text-muted-foreground">
                  Choose any whole-second length from 5 seconds to 10 minutes. This controls the scene plan, generation estimate, and credits before the render starts.
                </p>
              </div>
            </TabsContent>
          </Tabs>
          {fieldErrors.audio && (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-destructive">
              <XCircle className="h-4 w-4 shrink-0" /> {fieldErrors.audio}
            </p>
          )}
          </div>

          {/* ── Character Lock (optional reference image) ── */}
          <div className="rounded-xl border border-border/60 bg-background/30 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <ImageIcon className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-medium">
                  {imagePackMode ? "Reference Image" : "Character Lock"}
                </span>
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {imagePackMode
                    ? "— optional · consistent subject across the image pack"
                    : "— optional · same character in every shot"}
                </span>
              </div>
              {refImageObjectPath && (
                <button
                  onClick={() => {
                    setRefImageObjectPath(null);
                    if (refImagePreviewUrl) URL.revokeObjectURL(refImagePreviewUrl);
                    setRefImagePreviewUrl(null);
                    setRefImageError(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  Remove
                </button>
              )}
            </div>

            <input
              ref={refImageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleRefImageSelect(file);
                e.target.value = "";
              }}
            />

            {refImagePreviewUrl ? (
              <div className="px-4 pb-4 flex items-center gap-4">
                <div className="relative shrink-0">
                  <img
                    src={refImagePreviewUrl}
                    alt="Reference"
                    className="h-20 w-20 rounded-lg object-cover border border-border/40"
                  />
                  {isUploadingRefImage && (
                    <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center">
                      <Loader2 className="h-5 w-5 text-white animate-spin" />
                    </div>
                  )}
                </div>
                <div>
                  {isUploadingRefImage ? (
                    <p className="text-sm font-medium text-muted-foreground">Uploading…</p>
                  ) : refImageObjectPath ? (
                    <p className="text-sm font-medium text-green-500">
                      {imagePackMode ? "Reference image ready ✓" : "Character locked ✓"}
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-destructive">Upload failed — try again</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {imagePackMode
                      ? "Every image in this pack will use this visual reference"
                      : "This character anchors every shot in the video"}
                  </p>
                  <button
                    onClick={() => refImageInputRef.current?.click()}
                    className="text-xs text-primary hover:underline mt-1"
                  >
                    Change image
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-4 pb-4">
                <button
                  onClick={() => refImageInputRef.current?.click()}
                  disabled={isUploadingRefImage}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 hover:border-primary/50 hover:bg-primary/5 px-4 py-3 text-sm text-muted-foreground transition-colors"
                >
                  <Upload className="h-4 w-4" /> Upload a character (JPG, PNG, WebP)
                </button>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {imagePackMode
                    ? "Upload a subject or style reference and every image in the pack will use it for stronger visual consistency."
                    : "Upload a face or character and it anchors every generated shot, so the same character appears consistently across the whole video."}
                </p>
                {refImageError && (
                  <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                    <XCircle className="h-3 w-3" />{refImageError}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Prompt ── */}
          <div className="space-y-2">
            <Label htmlFor="prompt">Creative Prompt</Label>
            <Textarea
              ref={promptRef}
              id="prompt"
              placeholder="Describe the visual style, subject matter, and mood you want..."
              className={`min-h-[100px] resize-none bg-background/50 ${fieldErrors.prompt || prompt.length > 1000 ? "border-destructive" : "border-input"}`}
              value={prompt}
              maxLength={1000}
              onChange={(e) => { setPrompt(e.target.value); setFieldErrors((fe) => ({ ...fe, prompt: undefined })); }}
            />
            <div className="flex items-center justify-between">
              <div>
                {fieldErrors.prompt && (
                  <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                    <XCircle className="h-4 w-4 shrink-0" /> {fieldErrors.prompt}
                  </p>
                )}
              </div>
              <span className={`text-xs tabular-nums ${prompt.length >= 950 ? (prompt.length >= 1000 ? "text-destructive font-medium" : "text-yellow-500") : "text-muted-foreground"}`}>
                {prompt.length} / 1000
              </span>
            </div>
          </div>

          {/* ── Visual Style ── */}
          <div className="space-y-4" ref={styleRef}>
            <Label>Visual Style</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {STYLES.map((style) => {
                const Icon = style.icon;
                return (
                  <div
                    key={style.id}
                    onClick={() => setSelectedStyle(style.id)}
                    className={`cursor-pointer rounded-xl border p-4 transition-all hover:border-primary/50 flex flex-col items-center justify-center text-center gap-2 ${
                      selectedStyle === style.id
                        ? "border-primary bg-primary/10 shadow-glow"
                        : "border-border bg-background/50 hover:bg-background/80"
                    }`}
                  >
                    <Icon className="h-6 w-6 text-primary/80" />
                    <span className="text-sm font-medium">{style.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Captions / Lyrics ── */}
          <div className={`rounded-xl border border-border bg-background/30 p-5 space-y-4 ${imagePackMode ? "hidden" : ""}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <Label htmlFor="lyrics-toggle" className="cursor-pointer font-medium">
                  {sourceType === CreateJobRequestAudioSourceType.none
                    ? "On-screen text · burned-in captions"
                    : "Lyric video · karaoke captions"}
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                      aria-label="How lyric timing works"
                      data-testid="button-lyrics-info"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 text-sm" align="start">
                    <p className="font-semibold mb-2">How karaoke timing works</p>
                    <ul className="space-y-2 text-muted-foreground">
                      <li>
                        <span className="text-foreground font-medium">Plain lyrics</span> — lines are
                        spread evenly across the track; word fill is estimated.
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
                      Tip: Suno and most lyric sites can export .lrc files — paste the contents here.
                    </p>
                  </PopoverContent>
                </Popover>
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {sourceType === CreateJobRequestAudioSourceType.none
                    ? "— exact text burned into the video, not drawn by the AI"
                    : "— words fill in as they're sung, in sync with the track"}
                </span>
              </div>
              <Switch
                id="lyrics-toggle"
                checked={lyricsEnabled}
                onCheckedChange={setLyricsEnabled}
              />
            </div>

            {lyricsEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Textarea
                  placeholder={
                    sourceType === CreateJobRequestAudioSourceType.none
                      ? "Type the exact words you want on screen, one line at a time — a title, a CTA like \"Try it free at yoursite.com\", credits, etc. They'll be spread evenly across the video and rendered as real text."
                      : "Paste your lyrics here — or leave empty and hit Auto-sync to transcribe them from the track. LRC with [mm:ss] timestamps works too…"
                  }
                  className={`min-h-[120px] resize-none bg-background/50 ${
                    fieldErrors.lyrics ? "border-destructive" : "border-input"
                  }`}
                  value={lyricsText}
                  onChange={(e) => {
                    setLyricsText(e.target.value);
                    setFieldErrors((current) => ({
                      ...current,
                      lyrics: undefined,
                    }));
                  }}
                  maxLength={MAX_LYRICS_LENGTH}
                />
                <div className="flex items-center justify-between gap-3 mt-1.5">
                  <p
                    className={`text-xs ${
                      lyricsText.length > MAX_LYRICS_LENGTH
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {lyricsText.length.toLocaleString()}/
                    {MAX_LYRICS_LENGTH.toLocaleString()} characters
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
                      data-testid="button-lyrics-sample"
                    >
                      Try a sample
                    </button>
                  )}
                </div>
                {fieldErrors.lyrics && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-destructive">
                    <XCircle className="h-4 w-4 shrink-0" />
                    {fieldErrors.lyrics}
                  </p>
                )}

                {/* Auto-sync to vocals — available for uploaded files and resolved Suno tracks */}
                {sourceType !== CreateJobRequestAudioSourceType.none && (
                  <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {lyricsSyncNote ??
                        (!canAutoSync
                          ? sourceType === CreateJobRequestAudioSourceType.upload
                            ? "Upload your track above, then Auto-sync can time each word to the vocals (2 credits)."
                            : "Load a Suno track above, then Auto-sync can time each word to the vocals (2 credits)."
                          : /\[\d{1,2}:\d{2}/.test(lyricsText)
                              ? "Timestamps detected — already synced."
                              : sourceType === CreateJobRequestAudioSourceType.suno
                                ? "Auto-sync imports your Suno track and times each word (2 credits). Leave the box empty to transcribe too."
                                : "Auto-sync listens to the track and times each word (2 credits). Leave the box empty to transcribe the lyrics too.")}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={autoSyncLyrics}
                      disabled={lyricsSyncing || !canAutoSync}
                      className="gap-2 shrink-0"
                      data-testid="button-generate-autosync"
                    >
                      {lyricsSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {lyricsSyncing ? "Listening to the track…" : "Auto-sync to vocals"}
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label="Auto-sync cost details" className="text-muted-foreground hover:text-foreground transition-colors shrink-0" data-testid="tooltip-generate-autosync-cost">
                          <Info className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px] text-xs">
                        Auto-sync costs {LYRIC_ALIGN_COST} credits each run — AI listens to your track and times every word to the vocals. Generating with lyrics also adds {LYRIC_OVERLAY_COST} credits to the video's cost for the karaoke burn (already included in the price shown).
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </motion.div>
            )}
          </div>

          {/* ── Settings Summary ── */}
          <div className={`flex flex-wrap gap-2 text-xs text-muted-foreground ${imagePackMode ? "hidden" : ""}`}>
            <span className="rounded-full border border-border/40 bg-secondary/30 px-2.5 py-1">
               {aspectRatio} · {resolution} · {
                 sourceType === CreateJobRequestAudioSourceType.none ? `Silent · ${formatDuration(silentFilmDurationSeconds)}`
                   : requestedDuration === CreateJobRequestRequestedDuration.full ? fullTrackLabel
                  : (requestedDuration as string) === "300" ? "5 min"
                  : (requestedDuration as string) === "600" ? "10 min"
                  : `${durationToSeconds(requestedDuration)}s`
              }
            </span>
            {character !== "none" && (
              <span className="rounded-full border border-border/40 bg-secondary/30 px-2.5 py-1">
                {characterLabel}
              </span>
            )}
            {lyricsEnabled && (
              <span className="rounded-full border border-primary/30 bg-primary/10 text-primary px-2.5 py-1">
                Captions on
              </span>
            )}
            {refImageObjectPath && (
              <span className="rounded-full border border-primary/30 bg-primary/10 text-primary px-2.5 py-1">
                🔒 Character locked
              </span>
            )}
          </div>
          {!imagePackMode && fullTrackOverLimit && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                This track is {formatDuration(songDurationSec)}. Full-track videos currently support audio up to {Math.floor(MAX_FULL_SECONDS / 60)} minutes; choose a shorter track or a specific duration.
              </span>
            </div>
          )}

          {/* ── Copyright Acknowledgment (not applicable to a silent "no audio" render) ── */}
          {!imagePackMode && sourceType !== CreateJobRequestAudioSourceType.none && (
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={copyrightAcknowledged}
                onChange={(e) => setCopyrightAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary cursor-pointer"
              />
              <span className="text-xs text-muted-foreground leading-relaxed group-hover:text-foreground/80 transition-colors">
                I confirm I have the right to use this audio (owned, licensed, or royalty-free).
              </span>
            </label>
          )}

          {/* ── Generate ── */}
          {(() => {
            return (
              <div className="space-y-2">
                <Button
                  size="lg"
                  className="w-full h-14 text-lg bg-gradient-electric text-white shadow-glow mt-2"
                  disabled={
                    createJob.isPending ||
                    imagePackSubmitting ||
                    isUploadingRefImage ||
                    (!imagePackMode && (
                      isCurrentAudioAnalysisPending ||
                      fullTrackNeedsAnalysis ||
                      fullTrackOverLimit ||
                      (sourceType !== CreateJobRequestAudioSourceType.none && !copyrightAcknowledged)
                    ))
                  }
                  onClick={handleGenerate}
                >
                  {createJob.isPending || imagePackSubmitting ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : !imagePackMode && isCurrentAudioAnalysisPending ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      <span>Analysing audio…</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-5 w-5" />
                      <span className="hidden sm:inline">
                        {imagePackMode ? "Generate Image Pack" : "Generate Beat-Synced Video"}
                      </span>
                      <span className="sm:hidden">
                        {imagePackMode ? "Generate Images" : "Generate Video"}
                      </span>
                    </>
                  )}
                </Button>
                <div className={`flex items-center justify-center gap-1.5 text-xs ${canAfford ? "text-muted-foreground" : "text-destructive font-medium"}`}>
                  <Coins className="h-3.5 w-3.5" />
                  <span>
                    {isAdmin ? (
                      <>Unlimited generation — admin account</>
                    ) : (
                      <>
                        Costs <strong>{activeCost} credits</strong>
                        {balance !== null && (
                          <> — you have <strong className={canAfford ? "" : "text-destructive"}>{balance} remaining</strong></>
                        )}
                      </>
                    )}
                  </span>
                  {!canAfford && !isAdmin && (
                    <span className="ml-1">— insufficient balance</span>
                  )}
                </div>
                <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>
                    {imagePackMode ? (
                      <>
                        {imagePackCount} standalone {imagePackCount === 1 ? "image" : "images"}
                        {refImageObjectPath ? " · reference consistency on" : ""}
                        {" · "}credits reserved when the job starts
                      </>
                    ) : (
                      <>
                        Typically <strong>{generationEstimate.label}</strong>
                        {" · "}{generationEstimate.unitCount} AI{" "}
                        {generationMode === CreateJobRequestGenerationMode.narrative
                          ? generationEstimate.unitCount === 1 ? "scene" : "unique scenes"
                          : generationEstimate.unitCount === 1 ? "visual" : "visuals"}
                        {" · "}credits reserved when the job starts
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      </motion.div>
    </div>

    {/* ── Duration Warning Dialog ── */}
    {(() => {
      const durSec = effectiveRequestedDuration === CreateJobRequestRequestedDuration.full
        ? null
        : parseInt(effectiveRequestedDuration as string, 10);
      const isLong = durSec !== null && durSec >= 90;
      if (!isLong) return null;
      const numClips = generationEstimate.unitCount;
      const estimatedMin = generationEstimate.label;
       const durLabel = durSec === 300 ? "5-minute" : durSec === 600 ? "10-minute" : formatDuration(durSec);
       const creditCost = cost;
      return (
        <Dialog open={durationWarningOpen} onOpenChange={setDurationWarningOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 rounded-full bg-yellow-500/15 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                </div>
                <DialogTitle className="text-left">Long video — heads up!</DialogTitle>
              </div>
              <DialogDescription asChild>
                <div className="text-left space-y-3 mt-1">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    A <strong className="text-foreground">{durLabel}</strong> video requires{" "}
                    <strong className="text-foreground">
                      {numClips} separate AI{" "}
                      {generationMode === CreateJobRequestGenerationMode.narrative
                        ? "chronological scene generations"
                        : "visual generations"}
                    </strong>{" "}
                    and
                    typically takes <strong className="text-foreground">{estimatedMin}</strong> to complete.
                    The job may appear idle for several minutes — this is normal.
                  </p>
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Estimated time</span>
                      <span className="font-medium">{estimatedMin}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {generationMode === CreateJobRequestGenerationMode.narrative
                          ? "Unique scenes generated"
                          : "AI visuals generated"}
                      </span>
                      <span className="font-medium">
                        {numClips} {generationMode === CreateJobRequestGenerationMode.narrative ? "scenes" : "visuals"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">AI engine</span>
                      <span className="font-medium">{PROVIDER_LABELS[aiProvider]}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Credit cost</span>
                      <span className="font-medium">{creditCost} credits</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    You can monitor progress on the job page. Don't close the tab — it will finish in the background.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
              <Button
                variant="outline"
                className="sm:order-1"
                onClick={() => setDurationWarningOpen(false)}
              >
                Go back
              </Button>
              <Button
                className="bg-gradient-electric text-white shadow-glow border-0 sm:order-2"
                disabled={createJob.isPending}
                onClick={() => {
                  setDurationWarningOpen(false);
                  setConfirmOpen(true);
                }}
              >
                {createJob.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Start generation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    })()}

    {/* ── Confirm Generation Dialog ── */}
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5 text-primary" />
            </div>
              <DialogTitle className="text-left">
                {imagePackMode ? "Confirm Image Pack" : "Confirm Video Generation"}
              </DialogTitle>
          </div>
          <DialogDescription asChild>
            <div className="text-left space-y-3 mt-1">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {imagePackMode
                  ? `Review the image pack below. The saved ${imagePackAspectRatio === "9:16" ? "portrait" : "landscape"} images will be ready to add directly to Remix Lab.`
                  : "Review the details below. Once confirmed, the job will be submitted for admin approval before processing begins."}
              </p>
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Style</span>
                  <span className="font-medium capitalize">{STYLES.find((s) => s.id === selectedStyle)?.label ?? selectedStyle}</span>
                </div>
                {imagePackMode && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Images</span>
                      <span className="font-medium">{imagePackCount} images · {imagePackAspectRatio}</span>
                    </div>
                    {refImageObjectPath && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Reference</span>
                        <span className="font-medium text-primary">Consistency enabled</span>
                      </div>
                    )}
                  </>
                )}
                {!imagePackMode && refImageObjectPath && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Character</span>
                    <span className="font-medium text-primary">🔒 Locked across all shots</span>
                  </div>
                )}
                {!imagePackMode && <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="font-medium">
                    {sourceType === CreateJobRequestAudioSourceType.none
                      ? `Silent · ${formatDuration(silentFilmDurationSeconds)}`
                      : requestedDuration === CreateJobRequestRequestedDuration.full
                      ? `${fullTrackLabel} · exact audio length`
                      : `${requestedDuration}s`}
                  </span>
                </div>}
                {!imagePackMode && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Image foundation · {generationEstimate.unitCount} images</span>
                      <span>{generatedImageCost} credits</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Video animation · {generationEstimate.unitCount} scenes</span>
                      <span>{videoAnimationCost} credits</span>
                    </div>
                    {lyricAddon > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Lyrics overlay</span>
                        <span>{lyricAddon} credits</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credit cost</span>
                  <span className="font-medium">{activeCost} credits</span>
                </div>
                {!imagePackMode && lipSyncAddon > 0 && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">AI Lip Sync · {fullTrackLipSyncSeconds}s</span>
                      <span>{lipSyncAddon} credits</span>
                    </div>
                    <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs text-muted-foreground">
                      One combined reservation creates two videos: the full-track music video and a separate AI Lip Sync performance from {Math.floor(clipStartTime)}s–{Math.floor(clipStartTime + fullTrackLipSyncSeconds)}s.
                    </div>
                  </>
                )}
              </div>

              {/* Storyboard preview — the shots we'll generate, before you spend credits */}
              {!imagePackMode && <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium flex items-center gap-1.5 text-foreground">
                    <Clapperboard className="h-4 w-4 text-primary" />
                    {generationMode === CreateJobRequestGenerationMode.narrative ? "Narrative plan" : "Montage plan"}
                    {shotPlan
                      ? ` · ${shotPlan.numClips} unique ${generationMode === CreateJobRequestGenerationMode.narrative ? "scenes" : "visuals"}`
                      : ""}
                  </span>
                  {shotPlan?.approximate && (
                    <span className="text-[10px] text-muted-foreground">approximate — analyze audio for exact</span>
                  )}
                </div>
                {shotPlanLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Planning shots…
                  </div>
                )}
                {shotPlan && shotPlan.shots.length > 0 && (
                  <>
                    <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                      {shotPlan.timelineSceneCount} {generationMode === CreateJobRequestGenerationMode.narrative ? "chronological scenes" : "music-timed cuts"}
                      {generationMode === CreateJobRequestGenerationMode.narrative
                        ? " · exact continuity, no visual reuse"
                        : (shotPlan.reuseCount > 0
                          ? ` · ${shotPlan.reuseCount} intentional visual recalls keep the price lower`
                          : " · no visual reuse needed")}
                    </p>
                    <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
                      {shotPlan.shots.map((s) => (
                        <div key={s.index} className="text-xs">
                          <div className="flex items-center gap-2 font-medium text-foreground">
                            <span className="inline-flex h-4 min-w-[1rem] px-1 items-center justify-center rounded bg-primary/15 text-primary text-[10px]">
                              {s.index + 1}
                            </span>
                            <span>{s.description ?? s.label}</span>
                            <span className="text-muted-foreground font-normal">· {Math.round(s.energy * 100)}% energy</span>
                          </div>
                          <p className="text-muted-foreground mt-0.5 leading-snug">
                            {generationMode === CreateJobRequestGenerationMode.narrative
                              ? `${s.label} scene`
                              : `${s.label} visual`}
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>}
            </div>
          </DialogDescription>
        </DialogHeader>
        {!imagePackMode && (fullTrackNeedsAnalysis || fullTrackOverLimit) && (
          <div
            className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
            role="status"
          >
            {isCurrentAudioAnalysisPending ? (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>
              {fullTrackOverLimit
                ? `This track is longer than the ${Math.floor(MAX_FULL_SECONDS / 60)}-minute Full track limit. Choose a specific duration.`
                : isCurrentAudioAnalysisPending
                  ? "Audio analysis is still running. Confirmation will unlock when it finishes."
                  : "Audio analysis is unavailable. Close this window to retry or choose a specific duration."}
            </span>
          </div>
        )}
        <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
          <Button
            variant="outline"
            className="sm:order-1"
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            className="bg-gradient-electric text-white shadow-glow border-0 sm:order-2"
            disabled={createJob.isPending || imagePackSubmitting || (!imagePackMode && (fullTrackNeedsAnalysis || fullTrackOverLimit))}
            onClick={submitJob}
          >
            {createJob.isPending || imagePackSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldAlert className="mr-2 h-4 w-4" />
            )}
            {imagePackMode ? "Confirm & Generate Images" : "Confirm & Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Error Dialog ── */}
    <Dialog open={errorDialog.open} onOpenChange={(open) => setErrorDialog((s) => ({ ...s, open }))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            {errorDialog.code === "INSUFFICIENT_CREDITS" ? (
              <div className="h-10 w-10 rounded-full bg-yellow-500/15 flex items-center justify-center shrink-0">
                <CreditCard className="h-5 w-5 text-yellow-500" />
              </div>
            ) : errorDialog.code === "SUBSCRIPTION_REQUIRED" ? (
              <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <Crown className="h-5 w-5 text-primary" />
              </div>
            ) : (
              <div className="h-10 w-10 rounded-full bg-destructive/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
            )}
            <DialogTitle className="text-left">{errorDialog.title}</DialogTitle>
          </div>
          <DialogDescription className="text-left text-sm leading-relaxed">
            {errorDialog.message}
          </DialogDescription>

          {errorDialog.code === "INSUFFICIENT_CREDITS" && errorDialog.creditsRequired !== undefined && (
            <div className="mt-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Credits needed</span>
                <span className="font-medium">{errorDialog.creditsRequired}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Your balance</span>
                <span className="font-medium text-destructive">{errorDialog.creditsRemaining ?? 0}</span>
              </div>
            </div>
          )}
        </DialogHeader>

        <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
          <Button
            variant="outline"
            className="sm:order-1"
            onClick={() => setErrorDialog((s) => ({ ...s, open: false }))}
          >
            Dismiss
          </Button>

          {(errorDialog.code === "INSUFFICIENT_CREDITS" ||
            errorDialog.code === "SUBSCRIPTION_REQUIRED") && (
            <Link href="/pricing">
              <Button className="w-full sm:w-auto bg-gradient-electric text-white shadow-glow border-0 sm:order-2">
                <Crown className="mr-2 h-4 w-4" />
                View Plans
              </Button>
            </Link>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <TopUpRequiredDialog
      open={topUpOpen}
      onOpenChange={setTopUpOpen}
      creditsRequired={cost}
      creditsRemaining={balance ?? 0}
      title="More credits needed to generate this video"
    />
    </>
  );
}
