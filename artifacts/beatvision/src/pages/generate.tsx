import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { AudioWaveformSelector } from "@/components/AudioWaveformSelector";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import {
  useCreateJob,
  useGetDashboardStats,
  CreateJobRequestAudioSourceType,
  CreateJobRequestAspectRatio,
  CreateJobRequestResolution,
  CreateJobRequestRequestedDuration,
  VideoStyle,
} from "@workspace/api-client-react";
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
  ChevronDown, User, Maximize2, Captions, Diamond, Pencil, MonitorPlay, ImageIcon,
  Lock, Clock, Crown, Coins, AlertTriangle, CreditCard,
} from "lucide-react";

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

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return 0;
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000));
}

// Mirrors server-side calculateCreditCost — must stay in sync with creditCost.ts
const MAX_CLIPS_PER_JOB = 3;
const RUNWAY_TOKENS_PER_5S = 165;
const RUNWAY_TOKENS_PER_10S = 330;
const RUNWAY_USD_PER_TOKEN = 0.01;
const MARKUP = 2;
const USD_PER_CREDIT = 0.02;

function estimateCreditCost(requestedDuration: CreateJobRequestRequestedDuration | null | undefined): number {
  const dur = requestedDuration ?? CreateJobRequestRequestedDuration.full;
  let clipDurationSec: 5 | 10;
  let numClips: number;
  if (dur === CreateJobRequestRequestedDuration.full) {
    clipDurationSec = 10;
    numClips = MAX_CLIPS_PER_JOB;
  } else {
    const durSec = parseInt(dur as string, 10);
    clipDurationSec = durSec <= 5 ? 5 : 10;
    numClips = Math.max(1, Math.ceil(durSec / clipDurationSec));
  }
  const tokensPerClip = clipDurationSec === 5 ? RUNWAY_TOKENS_PER_5S : RUNWAY_TOKENS_PER_10S;
  const chargeUSD = numClips * tokensPerClip * RUNWAY_USD_PER_TOKEN * MARKUP;
  return Math.ceil(chargeUSD / USD_PER_CREDIT);
}

export default function Generate() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const styleRef = useRef<HTMLDivElement>(null);

  const [sourceType, setSourceType] = useState<CreateJobRequestAudioSourceType>(
    CreateJobRequestAudioSourceType.upload,
  );
  const [audioUrl, setAudioUrl] = useState("");
  const [sunoInputUrl, setSunoInputUrl] = useState("");
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
  const [removeWatermark, setRemoveWatermark] = useState(false);
  const [requestedDuration, setRequestedDuration] = useState<CreateJobRequestRequestedDuration>(CreateJobRequestRequestedDuration.NUMBER_10);
  const [clipStartTime, setClipStartTime] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [errorDialog, setErrorDialog] = useState<ErrorDialogState>({ open: false, title: "", message: "" });
  const [copyrightAcknowledged, setCopyrightAcknowledged] = useState(false);

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

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthLoading, isAuthenticated, setLocation]);

  if (isAuthLoading || !isAuthenticated) return null;

  const isAdmin = user?.isAdmin ?? false;
  const subStatus = user?.subscriptionStatus ?? "none";
  const trialDaysLeft = daysUntil(user?.trialEndsAt ?? null);
  const trialExpired = subStatus === "trial" && trialDaysLeft === 0;
  const canCreate = isAdmin || subStatus === "active" || (subStatus === "trial" && !trialExpired);

  if (!canCreate) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="flex justify-center">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
              {trialExpired ? (
                <Clock className="h-10 w-10 text-primary" />
              ) : (
                <Lock className="h-10 w-10 text-primary" />
              )}
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-3">
              {trialExpired ? "Your Trial Has Ended" : "Subscription Required"}
            </h2>
            <p className="text-muted-foreground text-lg">
              {trialExpired
                ? "Your 7-day free trial has expired. Upgrade to Pro to keep creating AI music videos."
                : "You need an active subscription to create videos."}
            </p>
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-left space-y-3">
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
          <Button
            size="lg"
            className="w-full bg-gradient-electric text-white shadow-glow text-base"
            onClick={() => alert("Subscription billing coming soon — check back shortly!")}
          >
            <Crown className="mr-2 h-5 w-5" />
            Upgrade to Pro
          </Button>
          <p className="text-xs text-muted-foreground">
            Contact support if you believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  const characterLabel = CHARACTERS.find((c) => c.value === character)?.label ?? "None";

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
      // Scroll to the first error field
      if (errors.audio) {
        audioSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (errors.prompt) {
        promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        promptRef.current?.focus();
      }
      return;
    }

    setFieldErrors({});

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
          removeWatermark,
          referenceImagePath: refImageObjectPath ?? null,
          requestedDuration,
          clipStartTime:
            requestedDuration !== CreateJobRequestRequestedDuration.full &&
            sourceType === CreateJobRequestAudioSourceType.upload &&
            clipStartTime > 0
              ? clipStartTime
              : null,
        },
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
          else if (code === "TRIAL_EXPIRED") title = "Trial expired";
          else if (code === "SUBSCRIPTION_REQUIRED") title = "Subscription required";

          setErrorDialog({ open: true, title, message, code, creditsRequired, creditsRemaining });
        },
      },
    );
  };

  return (
    <>
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      {subStatus === "trial" && !isAdmin && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary shrink-0" />
            <span>
              Free trial — <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}</strong> remaining.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-primary/40 text-primary hover:bg-primary/10 shrink-0"
            onClick={() => alert("Subscription billing coming soon!")}
          >
            <Crown className="mr-1.5 h-3.5 w-3.5" />
            Upgrade
          </Button>
        </div>
      )}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
      >
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">Create New Video</h1>
          <p className="text-muted-foreground">
            Upload a track, our AI analyses the beats, and generates a synced music video.
          </p>
        </div>

        <div className="grid gap-8 p-8 rounded-2xl bg-card border border-card-border shadow-lg">

          {/* ── Settings Toolbar ── */}
          <div className="rounded-xl border border-border/60 bg-background/40 overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-background/20">
              <span className="text-xs text-muted-foreground font-medium">Video Settings</span>
              <Maximize2 className="h-3.5 w-3.5 text-muted-foreground/50" />
            </div>

            {/* Pill row */}
            <div className="flex items-center gap-1 px-3 py-2 flex-wrap">

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

              <div className="h-5 w-px bg-border/40 mx-0.5" />

              {/* Duration */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 hover:bg-secondary/70 px-3 py-1.5 text-sm font-medium transition-colors">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{durationToSeconds(requestedDuration) ?? 10}s</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  {([
                    { value: CreateJobRequestRequestedDuration.NUMBER_5, label: "5 seconds" },
                    { value: CreateJobRequestRequestedDuration.NUMBER_10, label: "10 seconds" },
                  ] as const).map(({ value, label }) => (
                    <DropdownMenuItem
                      key={value}
                      onClick={() => handleDurationChange(value)}
                      className={requestedDuration === value ? "text-primary font-medium" : ""}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="h-5 w-px bg-border/40 mx-0.5" />

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
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="h-5 w-px bg-border/40 mx-0.5" />

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

              <div className="h-5 w-px bg-border/40 mx-0.5" />

              {/* Remove watermark */}
              <button
                onClick={() => setRemoveWatermark((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  removeWatermark
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/50 bg-secondary/40 hover:bg-secondary/70"
                }`}
              >
                <Diamond className="h-3.5 w-3.5" />
                <span>Remove watermark</span>
                <div className={`ml-1 h-4 w-4 rounded flex items-center justify-center border transition-colors ${
                  removeWatermark ? "bg-primary border-primary" : "border-border/60 bg-transparent"
                }`}>
                  {removeWatermark && (
                    <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 10 10">
                      <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
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
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4" /> Upload Audio
              </TabsTrigger>
              <TabsTrigger
                value={CreateJobRequestAudioSourceType.youtube}
                className="flex items-center gap-2"
              >
                <LinkIcon className="h-4 w-4" /> YouTube
              </TabsTrigger>
              <TabsTrigger
                value={CreateJobRequestAudioSourceType.suno}
                className="flex items-center gap-2"
              >
                <MonitorPlay className="h-4 w-4 text-[#1DB954]" /> Suno
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
                  className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-colors cursor-pointer border-border hover:border-primary/50 hover:bg-primary/5"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center">
                      <Music className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-lg">Drop your audio here</p>
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
                  <div className="flex items-center gap-2 text-sm font-medium text-primary mb-3">
                    <Clock className="h-4 w-4" />
                    <span>Select clip section</span>
                    <span className="text-muted-foreground font-normal text-xs ml-auto">
                      Drag both handles to choose your {durationToSeconds(requestedDuration) ?? 10}s window
                    </span>
                  </div>
                  <AudioWaveformSelector
                    file={uploadedFile}
                    clipDurationSec={durationToSeconds(requestedDuration) ?? 10}
                    clipStartTime={clipStartTime}
                    onClipStartTimeChange={setClipStartTime}
                  />
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
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Reference Image</span>
                <span className="text-xs text-muted-foreground">— optional, sets the starting frame</span>
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
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <Label htmlFor="lyrics-toggle" className="cursor-pointer font-medium">
                  Captions / Lyrics Overlay
                </Label>
                <span className="text-xs text-muted-foreground">
                  — burns subtitle text onto the video
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
                  placeholder="Paste your lyrics here. They'll be overlaid on the video as rolling subtitles..."
                  className="min-h-[120px] resize-none bg-background/50 border-input"
                  value={lyricsText}
                  onChange={(e) => setLyricsText(e.target.value)}
                  maxLength={5000}
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  {lyricsText.length}/5000 characters
                </p>
              </motion.div>
            )}
          </div>

          {/* ── Settings Summary ── */}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/40 bg-secondary/30 px-2.5 py-1">
              {aspectRatio} · {resolution} · {requestedDuration}s
            </span>
            {character !== "none" && (
              <span className="rounded-full border border-border/40 bg-secondary/30 px-2.5 py-1">
                {characterLabel}
              </span>
            )}
            {removeWatermark && (
              <span className="rounded-full border border-primary/30 bg-primary/10 text-primary px-2.5 py-1">
                Watermark removed
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
            const cost = estimateCreditCost(requestedDuration);
            const balance = statsData?.creditsRemaining ?? null;
            const canAfford = balance === null || balance >= cost;
            return (
              <div className="space-y-2">
                <Button
                  size="lg"
                  className="w-full h-14 text-lg bg-gradient-electric text-white shadow-glow mt-2"
                  disabled={createJob.isPending || !canAfford || !copyrightAcknowledged}
                  onClick={handleGenerate}
                >
                  {createJob.isPending ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-5 w-5" />
                      Generate Beat-Synced Video
                    </>
                  )}
                </Button>
                <div className={`flex items-center justify-center gap-1.5 text-xs ${canAfford ? "text-muted-foreground" : "text-destructive font-medium"}`}>
                  <Coins className="h-3.5 w-3.5" />
                  <span>
                    Costs <strong>{cost} credits</strong>
                    {balance !== null && (
                      <> — you have <strong className={canAfford ? "" : "text-destructive"}>{balance} remaining</strong></>
                    )}
                  </span>
                  {!canAfford && (
                    <span className="ml-1">— insufficient balance</span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </motion.div>
    </div>

    {/* ── Error Dialog ── */}
    <Dialog open={errorDialog.open} onOpenChange={(open) => setErrorDialog((s) => ({ ...s, open }))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            {errorDialog.code === "INSUFFICIENT_CREDITS" ? (
              <div className="h-10 w-10 rounded-full bg-yellow-500/15 flex items-center justify-center shrink-0">
                <CreditCard className="h-5 w-5 text-yellow-500" />
              </div>
            ) : errorDialog.code === "TRIAL_EXPIRED" || errorDialog.code === "SUBSCRIPTION_REQUIRED" ? (
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
            errorDialog.code === "TRIAL_EXPIRED" ||
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
