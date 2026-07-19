import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { AudioWaveformSelector } from "@/components/AudioWaveformSelector";
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
  VideoStyle,
  type CreateJobRequest,
} from "@workspace/api-client-react";
import { estimateCreditCost, PROVIDER_LABELS, type AiProvider } from "@/lib/creditPricing";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Upload, Link as LinkIcon, Music, Sparkles, Loader2, CheckCircle2, XCircle,
  Users, Clapperboard, Layers, Zap, Film, Wand2, Video as VideoIcon, FileText,
  ChevronDown, User, Maximize2, Captions, Pencil, MonitorPlay, ImageIcon,
  Lock, Crown, Coins, AlertTriangle, CreditCard, Clock, ShieldAlert, Info,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Original sample lyrics (safe to ship — written for this app) showing all
// three timing formats the karaoke engine understands: word-level tags on the
// first lines, plain [mm:ss] line tags after, and a comment for plain text.
const SAMPLE_LYRICS = `[00:02]<00:02.00>City <00:02.40>lights <00:02.90>are <00:03.10>calling <00:03.70>my <00:03.95>name
[00:05]<00:05.00>Every <00:05.50>beat <00:05.90>is <00:06.10>burning <00:06.70>like <00:06.95>a <00:07.15>flame
[00:08]I can feel the rhythm in the rain
[00:11]Nothing's gonna stop us now
[00:14]We were made to light the sky
[00:17]Neon hearts that never die
[00:20]Turn it up and let it fly
[00:23]This is our tonight`;

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
  { id: "square", label: "Square feed", emoji: "⬛", aspect: CreateJobRequestAspectRatio["1:1"], duration: CreateJobRequestRequestedDuration.NUMBER_10 },
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

const CHARACTERS = [
  { value: "none", label: "None" },
  { value: "a person", label: "Person" },
  { value: "a couple", label: "Couple" },
  { value: "a crowd of people", label: "Crowd" },
  { value: "an abstract form", label: "Abstract" },
  { value: "an animal", label: "Animal" },
] as const;
type CharacterValue = (typeof CHARACTERS)[number]["value"];

// estimateCreditCost + provider pricing now live in "@/lib/creditPricing"
// (imported above) so the generate page and pricing page share one source.

export default function Generate() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const styleRef = useRef<HTMLDivElement>(null);

  const [sourceType, setSourceType] = useState<CreateJobRequestAudioSourceType>(
    CreateJobRequestAudioSourceType.upload,
  );
  const [audioUrl, setAudioUrl] = useState("");
  const [sunoInputUrl, setSunoInputUrl] = useState("");
  const [sunoAutoResolve, setSunoAutoResolve] = useState(false);
  const [sunoResolving, setSunoResolving] = useState(false);
  const [sunoResolved, setSunoResolved] = useState<{ audioUrl: string; title: string; artist: string } | null>(null);
  const [sunoError, setSunoError] = useState<string | null>(null);
  const [objectPath, setObjectPath] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const audioSectionRef = useRef<HTMLDivElement>(null);
  const [fieldErrors, setFieldErrors] = useState<{ prompt?: string; audio?: string }>({});
  const [selectedStyle, setSelectedStyle] = useState<VideoStyle>(VideoStyle.cinematic);
  const [lyricsEnabled, setLyricsEnabled] = useState(false);
  const [lyricsText, setLyricsText] = useState("");

  // New settings
  const [aspectRatio, setAspectRatio] = useState<CreateJobRequestAspectRatio>(CreateJobRequestAspectRatio["16:9"]);
  const [resolution, setResolution] = useState<CreateJobRequestResolution>(CreateJobRequestResolution["720p"]);
  const [character, setCharacter] = useState<CharacterValue>("none");
  const [requestedDuration, setRequestedDuration] = useState<CreateJobRequestRequestedDuration>(CreateJobRequestRequestedDuration.NUMBER_10);
  const [aiProvider, setAiProvider] = useState<AiProvider>("runway");
  const [clipStartTime, setClipStartTime] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [errorDialog, setErrorDialog] = useState<ErrorDialogState>({ open: false, title: "", message: "" });
  const [copyrightAcknowledged, setCopyrightAcknowledged] = useState(false);
  const [durationWarningOpen, setDurationWarningOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Reference image
  const refImageInputRef = useRef<HTMLInputElement>(null);
  const [refImageObjectPath, setRefImageObjectPath] = useState<string | null>(null);
  const [refImagePreviewUrl, setRefImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingRefImage, setIsUploadingRefImage] = useState(false);
  const [refImageError, setRefImageError] = useState<string | null>(null);

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
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
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
        xhr.setRequestHeader("Content-Type", file.type);
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
  // Track which objectPath the current analysis result belongs to.
  // This prevents stale results from a previous upload being submitted with a new job.
  const [analysisForPath, setAnalysisForPath] = useState<string | null>(null);

  // Quick-start: apply a template's prompt/style/aspect/duration in one click.
  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    setPrompt(t.prompt);
    setSelectedStyle(t.style);
    setAspectRatio(t.aspect);
    handleDurationChange(t.duration);
    setFieldErrors((fe) => ({ ...fe, prompt: undefined }));
  }

  // Platform preset: set aspect ratio + duration for a target in one click.
  function applyPreset(p: (typeof PLATFORM_PRESETS)[number]) {
    setAspectRatio(p.aspect);
    handleDurationChange(p.duration);
  }

  // Quick-start: load a bundled royalty-free demo track so new users can try a
  // generation without hunting for audio. Requires public/demo-song.mp3.
  async function loadDemoSong() {
    try {
      setSourceType(CreateJobRequestAudioSourceType.upload);
      const res = await fetch("/demo-song.mp3");
      if (!res.ok) throw new Error("missing");
      const blob = await res.blob();
      const file = new File([blob], "demo-song.mp3", { type: blob.type || "audio/mpeg" });
      await handleFileSelect(file);
    } catch {
      toast({
        title: "Demo song unavailable",
        description: "Add a royalty-free public/demo-song.mp3 to enable this.",
        variant: "destructive",
      });
    }
  }

  // Trigger server-side analysis as soon as the upload path is available.
  // Reset mutation state immediately when objectPath changes so old badges disappear.
  useEffect(() => {
    if (sourceType === CreateJobRequestAudioSourceType.upload && objectPath) {
      analyzeAudio.reset();
      setAnalysisForPath(objectPath);
      analyzeAudio.mutate({ data: { objectPath } });
    } else {
      analyzeAudio.reset();
      setAnalysisForPath(null);
    }
    // analyzeAudio.mutate / analyzeAudio.reset are stable refs — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectPath, sourceType]);

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
      setSunoResolved({ audioUrl: data.audioUrl!, title: data.title ?? "Untitled", artist: data.artist ?? "" });
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

  if (!isAuthenticated) return null;

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

  const characterLabel = CHARACTERS.find((c) => c.value === character)?.label ?? "None";

  const submitJob = () => {
    createJob.mutate(
      {
        data: {
          prompt,
          style: selectedStyle,
          audioSourceType: sourceType,
          audioObjectPath:
            sourceType === CreateJobRequestAudioSourceType.upload ? objectPath : null,
          audioSourceUrl:
            sourceType === CreateJobRequestAudioSourceType.youtube ? audioUrl :
            sourceType === CreateJobRequestAudioSourceType.suno ? (sunoResolved?.audioUrl ?? null) : null,
          lyricsText: lyricsEnabled && lyricsText.trim() ? lyricsText.trim() : null,
          aspectRatio,
          resolution,
          character: character !== "none" ? character : null,
          referenceImagePath: refImageObjectPath ?? null,
          requestedDuration,
          aiProvider,
          clipStartTime:
            requestedDuration !== CreateJobRequestRequestedDuration.full &&
            sourceType === CreateJobRequestAudioSourceType.upload &&
            clipStartTime > 0
              ? clipStartTime
              : null,
          audioAnalysis:
            sourceType === CreateJobRequestAudioSourceType.upload &&
            analyzeAudio.isSuccess &&
            analysisForPath === objectPath &&
            analyzeAudio.data
              ? analyzeAudio.data
              : null,
          // Copyright/ownership attestation (gated by the checkbox above).
          acceptCopyright: copyrightAcknowledged,
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

          setErrorDialog({ open: true, title, message, code, creditsRequired, creditsRemaining });
        },
      },
    );
  };

  const handleGenerate = () => {
    const errors: { prompt?: string; audio?: string } = {};

    if (!prompt.trim()) {
      errors.prompt = "Please describe the visuals you want.";
    }
    if (sourceType === CreateJobRequestAudioSourceType.upload && !objectPath) {
      errors.audio = isUploading ? "Still uploading — wait a moment." : "Please upload an audio file.";
    }
    if (sourceType === CreateJobRequestAudioSourceType.youtube && !audioUrl.trim()) {
      errors.audio = "Please paste a YouTube URL.";
    }
    if (sourceType === CreateJobRequestAudioSourceType.suno && !sunoResolved) {
      errors.audio = sunoResolving ? "Loading track — wait a moment." : "Please load a Suno track first.";
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

    const durSec = requestedDuration === CreateJobRequestRequestedDuration.full
      ? null
      : parseInt(requestedDuration as string, 10);

    if (durSec === 90 || durSec === 120) {
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

        {/* ── Quick start: templates + demo song ── */}
        <div className="rounded-2xl border border-border/60 bg-background/30 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> Quick start
            </span>
            <Button variant="outline" size="sm" onClick={loadDemoSong}>
              <Music className="mr-1.5 h-3.5 w-3.5" /> Try a demo song
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className="rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-secondary/70"
              >
                <span className="mr-1">{t.emoji}</span>
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Templates fill in a prompt, style, aspect ratio, and length — tweak anything after.
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

        <div className="grid gap-5 sm:gap-8 p-4 sm:p-8 rounded-2xl bg-card border border-card-border shadow-lg">

          {/* ── Settings Toolbar ── */}
          <div className="rounded-xl border border-border/60 bg-background/40 overflow-hidden">
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
                        <span className="text-muted-foreground"> · {p === "runway" ? "high quality" : "high volume"}</span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">{estimateCreditCost(requestedDuration, p)} cr</span>
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
                    <span>{requestedDuration === CreateJobRequestRequestedDuration.full ? "full" : `${durationToSeconds(requestedDuration)}s`}</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  {([
                    { value: CreateJobRequestRequestedDuration.NUMBER_5, label: "5 seconds", note: null },
                    { value: CreateJobRequestRequestedDuration.NUMBER_10, label: "10 seconds", note: null },
                    { value: CreateJobRequestRequestedDuration.NUMBER_30, label: "30 seconds", note: null },
                    { value: CreateJobRequestRequestedDuration.NUMBER_60, label: "60 seconds", note: null },
                    { value: CreateJobRequestRequestedDuration.NUMBER_90, label: "90 seconds", note: "~15 min" },
                    { value: CreateJobRequestRequestedDuration.NUMBER_120, label: "120 seconds", note: "~20 min" },
                  ] as const).map(({ value, label, note }) => (
                    <DropdownMenuItem
                      key={value}
                      onClick={() => handleDurationChange(value)}
                      className={`flex items-center justify-between gap-3 ${requestedDuration === value ? "text-primary font-medium" : ""}`}
                    >
                      <span>{label}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {estimateCreditCost(value, aiProvider)} cr{note ? ` · ${note}` : ""}
                      </span>
                    </DropdownMenuItem>
                  ))}
                  <div className="px-2 pt-1 pb-1.5">
                    <p className="text-[10px] text-muted-foreground/60 leading-tight">
                      Longer videos use more clips and take more time to generate.
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
                    <span>{resolution}</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-28">
                  {RESOLUTIONS.map((r) => (
                    <DropdownMenuItem
                      key={r}
                      onClick={() => setResolution(r)}
                      className={resolution === r ? "text-primary font-medium" : ""}
                    >
                      {r}
                      {r === "4k" && (
                        <span className="ml-auto text-xs text-accent">+50%</span>
                      )}
                    </DropdownMenuItem>
                  ))}
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
          <div ref={audioSectionRef}>
          <Tabs
            value={sourceType}
            onValueChange={(v) => { setSourceType(v as CreateJobRequestAudioSourceType); setFieldErrors((e) => ({ ...e, audio: undefined })); }}
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
                value={CreateJobRequestAudioSourceType.youtube}
                className="flex items-center gap-1.5 text-xs sm:text-sm"
              >
                <LinkIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                <span>YouTube</span>
              </TabsTrigger>
              <TabsTrigger
                value={CreateJobRequestAudioSourceType.suno}
                className="flex items-center gap-1.5 text-xs sm:text-sm"
              >
                <MonitorPlay className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-[#1DB954]" />
                <span>Suno</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value={CreateJobRequestAudioSourceType.upload} className="mt-0 space-y-4">
              {/* Hidden native file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                  e.target.value = "";
                }}
              />

              {/* ── Drop zone — only shown when no file selected yet ── */}
              {!uploadedFile ? (
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
                      <p className="text-xs text-muted-foreground/60 mt-1">MP3, WAV, FLAC, AAC · up to 50 MB</p>
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
                        setUploadError(null);
                      }}
                    >
                      Change
                    </Button>
                  </div>
                </div>
              )}

              {/* ── Waveform Clip Selector — shown as soon as a file is chosen ── */}
              {uploadedFile && (
                <div className="rounded-xl border border-primary/30 bg-background/40 p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-primary mb-3">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span>Select clip section</span>
                    <span className="text-muted-foreground font-normal text-xs sm:ml-auto">
                      Drag to choose your {durationToSeconds(requestedDuration) ?? 10}s window
                    </span>
                  </div>
                  <AudioWaveformSelector
                    file={uploadedFile}
                    clipDurationSec={durationToSeconds(requestedDuration) ?? 10}
                    clipStartTime={clipStartTime}
                    onClipStartTimeChange={setClipStartTime}
                  />

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

                    {analyzeAudio.isError && !analyzeAudio.isPending && analysisForPath === objectPath && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-500/80">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Audio analysis unavailable — you can still generate.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value={CreateJobRequestAudioSourceType.youtube} className="mt-0">
              <div className="space-y-4">
                <Label htmlFor="audio-url">YouTube URL</Label>
                <Input
                  id="audio-url"
                  placeholder="https://youtube.com/watch?v=..."
                  value={audioUrl}
                  onChange={(e) => { setAudioUrl(e.target.value); setFieldErrors((fe) => ({ ...fe, audio: undefined })); }}
                  className={`h-12 bg-background/50 ${fieldErrors.audio ? "border-destructive" : "border-input"}`}
                />
              </div>
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
          </Tabs>
          {fieldErrors.audio && (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-destructive">
              <XCircle className="h-4 w-4 shrink-0" /> {fieldErrors.audio}
            </p>
          )}
          </div>

          {/* ── Reference Image (optional) ── */}
          <div className="rounded-xl border border-border/60 bg-background/30 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <ImageIcon className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-medium">Reference Image</span>
                <span className="text-xs text-muted-foreground hidden sm:inline">— optional, sets the starting frame</span>
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
                    <p className="text-sm font-medium text-green-500">Image ready</p>
                  ) : (
                    <p className="text-sm font-medium text-destructive">Upload failed — try again</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">Starting frame for each video clip</p>
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
                  <Upload className="h-4 w-4" /> Upload image (JPG, PNG, WebP)
                </button>
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
          <div className="rounded-xl border border-border bg-background/30 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <Label htmlFor="lyrics-toggle" className="cursor-pointer font-medium">
                  Lyric video · karaoke captions
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
                  — words fill in as they're sung, in sync with the track
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
                  placeholder="Paste plain lyrics — or an .lrc file with [mm:ss] timestamps for exact line sync (word-level <mm:ss> tags supported too)..."
                  className="min-h-[120px] resize-none bg-background/50 border-input"
                  value={lyricsText}
                  onChange={(e) => setLyricsText(e.target.value)}
                  maxLength={5000}
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
                      data-testid="button-lyrics-sample"
                    >
                      Try a sample
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </div>

          {/* ── Settings Summary ── */}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/40 bg-secondary/30 px-2.5 py-1">
              {aspectRatio} · {resolution} · {requestedDuration === CreateJobRequestRequestedDuration.full ? "full" : `${durationToSeconds(requestedDuration)}s`}
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
                Reference image set
              </span>
            )}
          </div>

          {/* ── Copyright Acknowledgment ── */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={copyrightAcknowledged}
              onChange={(e) => setCopyrightAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary cursor-pointer"
            />
            <span className="text-xs text-muted-foreground leading-relaxed group-hover:text-foreground/80 transition-colors">
              I confirm that I own the rights to the audio I'm uploading, or have obtained the necessary licenses to use it. I understand that uploading copyrighted music without permission violates the{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                Terms of Service
              </a>{" "}
              and may result in account termination.
            </span>
          </label>

          {/* ── Generate ── */}
          {(() => {
            const cost = estimateCreditCost(requestedDuration, aiProvider, resolution);
            const balance = statsData?.creditsRemaining ?? null;
            const canAfford = isAdmin || balance === null || balance >= cost;
            const isAnalyzingAudio =
              sourceType === CreateJobRequestAudioSourceType.upload &&
              objectPath !== null &&
              analysisForPath === objectPath &&
              analyzeAudio.isPending;
            return (
              <div className="space-y-2">
                <Button
                  size="lg"
                  className="w-full h-14 text-lg bg-gradient-electric text-white shadow-glow mt-2"
                  disabled={createJob.isPending || isAnalyzingAudio || !canAfford || !copyrightAcknowledged}
                  onClick={handleGenerate}
                >
                  {createJob.isPending ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : isAnalyzingAudio ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      <span>Analysing audio…</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-5 w-5" />
                      <span className="hidden sm:inline">Generate Beat-Synced Video</span>
                      <span className="sm:hidden">Generate Video</span>
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
                        Costs <strong>{cost} credits</strong>
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
              </div>
            );
          })()}
        </div>
      </motion.div>
    </div>

    {/* ── Duration Warning Dialog ── */}
    {(() => {
      const durSec = requestedDuration === CreateJobRequestRequestedDuration.full
        ? null
        : parseInt(requestedDuration as string, 10);
      const isLong = durSec === 90 || durSec === 120;
      if (!isLong) return null;
      const numClips = Math.ceil((durSec as number) / 10);
      const estimatedMin = durSec === 90 ? "~15 minutes" : "~20 minutes";
      const creditCost = estimateCreditCost(requestedDuration, aiProvider, resolution);
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
                    A <strong className="text-foreground">{durSec}-second</strong> video requires{" "}
                    <strong className="text-foreground">{numClips} separate AI clip generations</strong> and
                    typically takes <strong className="text-foreground">{estimatedMin}</strong> to complete.
                    The job may appear idle for several minutes — this is normal.
                  </p>
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Estimated time</span>
                      <span className="font-medium">{estimatedMin}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">AI clips generated</span>
                      <span className="font-medium">{numClips} clips</span>
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle className="text-left">Confirm Video Generation</DialogTitle>
          </div>
          <DialogDescription asChild>
            <div className="text-left space-y-3 mt-1">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Review the details below. Once confirmed, the job will be submitted for admin approval before processing begins.
              </p>
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Style</span>
                  <span className="font-medium capitalize">{STYLES.find((s) => s.id === selectedStyle)?.label ?? selectedStyle}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="font-medium">
                    {requestedDuration === CreateJobRequestRequestedDuration.full
                      ? "Full track"
                      : `${requestedDuration}s`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credit cost</span>
                  <span className="font-medium">{estimateCreditCost(requestedDuration, aiProvider, resolution)} credits</span>
                </div>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
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
            disabled={createJob.isPending}
            onClick={() => {
              setConfirmOpen(false);
              submitJob();
            }}
          >
            {createJob.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldAlert className="mr-2 h-4 w-4" />
            )}
            Confirm &amp; Generate
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
    </>
  );
}
