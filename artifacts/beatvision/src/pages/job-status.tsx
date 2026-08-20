import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { SAMPLE_LYRICS } from "@/lib/sampleLyrics";
import { LYRIC_ALIGN_COST, LYRIC_OVERLAY_COST } from "@/lib/creditPricing";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGetJob, getGetJobQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Music, CheckCircle2, AlertCircle, ArrowLeft,
  Play, RefreshCw, Download, ExternalLink, Clock,
  AudioWaveform, Clapperboard, Scissors, Sparkles, RotateCcw, Info,
  WifiOff, Wifi, FileAudio, Server, Zap, Plus, Link2, Check, ShieldAlert,
  TriangleAlert, X,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { Switch } from "@/components/ui/switch";
import SocialExportsPanel from "@/components/SocialExportsPanel";
import LipSyncPanel from "@/components/LipSyncPanel";
import ReferEarnCard from "@/components/ReferEarnCard";
import GenerationFiller from "@/components/GenerationFiller";

const TERMINAL_STATUSES = new Set(["ready", "failed"]);

const STAGES = [
  {
    key: "pending_approval",
    label: "Preparing",
    icon: ShieldAlert,
    description: "Getting your job ready to process…",
  },
  {
    key: "queued",
    label: "Queued",
    icon: Clock,
    description: "Waiting for a worker to pick up your job…",
  },
  {
    key: "analyzing",
    label: "Analysing",
    icon: AudioWaveform,
    description: "Decoding audio, detecting BPM, key, mood and song sections…",
  },
  {
    key: "generating",
    label: "Generating",
    icon: Clapperboard,
    description: "Creating AI video clips for each beat section…",
  },
  {
    key: "stitching",
    label: "Stitching",
    icon: Scissors,
    description: "Compositing clips, mixing audio and burning captions…",
  },
  {
    key: "ready",
    label: "Complete",
    icon: Sparkles,
    description: "Your beat-synced video is ready.",
  },
];

// Infer which clip is being generated from progressPercent (mirrors worker logic)
function inferClipProgress(
  status: string,
  pct: number,
  plan?: { numClips?: number },
): string | null {
  if (status !== "generating") return null;
  const n = plan?.numClips ?? 3;
  // Worker: pct goes from 30 to 30+(i/n)*40 per clip
  if (pct < 30) return `Starting clip generation…`;
  const clipIdx = Math.min(n - 1, Math.floor(((pct - 30) / 40) * n));
  return `Generating clip ${clipIdx + 1} of ${n}…`;
}

// Categorise error messages into user-friendly buckets
type ErrorCategory = "api" | "audio" | "quota" | "timeout" | "content" | "unknown";

function categoriseError(msg: string | null | undefined): {
  category: ErrorCategory;
  headline: string;
  detail: string;
  canRetry: boolean;
} {
  const m = (msg ?? "").toLowerCase();

  // Content policy / safety filter — check before generic "runway" match
  if (
    m.includes("content") ||
    m.includes("moderat") ||
    m.includes("nsfw") ||
    m.includes("safety") ||
    m.includes("violat") ||
    m.includes("explicit") ||
    m.includes("inappropriate") ||
    m.includes("policy")
  ) {
    return {
      category: "content",
      headline: "Prompt flagged by content filter",
      detail:
        "Your prompt or reference image was rejected by the AI safety filter. Try rephrasing your prompt — avoid explicit, violent, or trademarked content — and generate again.",
      canRetry: false,
    };
  }
  if (m.includes("runway") || m.includes("api error") || m.includes("api key")) {
    return {
      category: "api",
      headline: "AI generation service error",
      detail: "The AI engine returned an unexpected response. This is usually transient — retrying often fixes it.",
      canRetry: true,
    };
  }
  if (m.includes("ffmpeg") || m.includes("audio") || m.includes("pcm") || m.includes("decode")) {
    return {
      category: "audio",
      headline: "Audio processing failed",
      detail: "We couldn't decode your audio file. Make sure it's a valid MP3, WAV, FLAC, or AAC file and try again.",
      canRetry: false,
    };
  }
  if (m.includes("quota") || m.includes("rate limit") || m.includes("429")) {
    return {
      category: "quota",
      headline: "Rate limit reached",
      detail: "The generation service is temporarily rate-limited. Your job will automatically retry in a few minutes.",
      canRetry: true,
    };
  }
  if (m.includes("timeout") || m.includes("timed out") || m.includes("econnreset")) {
    return {
      category: "timeout",
      headline: "Connection timed out",
      detail: "The request to the AI service timed out. This can happen during high-traffic periods — retrying should work.",
      canRetry: true,
    };
  }
  return {
    category: "unknown",
    headline: "An unexpected error occurred",
    detail: "Something went wrong during processing. The full error has been logged. Please try again or start a new generation.",
    canRetry: true,
  };
}

function isAutoRetrying(msg: string | null | undefined): boolean {
  return /retry \d+\/\d+ in \d+m/.test(msg ?? "");
}

// Wall-clock elapsed since the job was created (ISO timestamp), ticking every
// second while active. Counting from job.createdAt (not page load) means the
// timer shows the true time the job has been running and survives refreshes.
function useElapsed(startIso: string | null | undefined, active: boolean): string {
  const getSecs = () => (startIso ? Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000)) : 0);
  const [secs, setSecs] = useState(getSecs);
  useEffect(() => {
    setSecs(getSecs());
    if (!active || !startIso) return;
    const id = setInterval(() => setSecs(getSecs()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, startIso]);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  }
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Returns elapsed milliseconds since a given ISO timestamp, updating every 5 seconds. */
function useWallElapsedMs(startIso: string | null | undefined, active: boolean): number {
  const getMs = () => (startIso ? Math.max(0, Date.now() - new Date(startIso).getTime()) : 0);
  const [ms, setMs] = useState(getMs);
  useEffect(() => {
    if (!active || !startIso) { setMs(0); return; }
    setMs(getMs());
    const id = setInterval(() => setMs(getMs()), 5000);
    return () => clearInterval(id);
  }, [active, startIso]);
  return ms;
}

/** Format a seconds count as a compact remaining-time string (e.g. "45s", "2m 10s", "1h 5m"). */
function fmtRemaining(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

/**
 * Estimates seconds remaining from the rate of progressPercent change over a
 * recent sliding window: rate = Δpercent/Δtime, eta = (100 − percent) / rate.
 * Returns null until there's enough signal (or when the estimate is wildly
 * uncertain). General across job types — and accurate for editor renders, which
 * now report smooth per-segment progress.
 */
function useEtaSeconds(percent: number, active: boolean): number | null {
  const samplesRef = useRef<{ t: number; p: number }[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) {
      samplesRef.current = [];
      return;
    }
    const now = Date.now();
    const arr = samplesRef.current;
    const last = arr[arr.length - 1];
    if (!last || last.p !== percent) {
      arr.push({ t: now, p: percent });
      const cutoff = now - 120_000; // keep ~2 min of history
      samplesRef.current = arr.filter((s) => s.t >= cutoff).slice(-30);
    }
  }, [percent, active]);

  // Tick every second so the estimate refreshes and counts down between updates.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;
  const arr = samplesRef.current;
  if (arr.length < 2) return null;
  const first = arr[0]!;
  const last = arr[arr.length - 1]!;
  const dt = (last.t - first.t) / 1000;
  const dp = last.p - first.p;
  if (dt <= 0 || dp <= 0) return null; // no forward progress yet
  const rate = dp / dt; // percent per second
  const remaining = Math.max(0, 100 - last.p);
  const sinceLast = (Date.now() - last.t) / 1000;
  const eta = remaining / rate - sinceLast;
  if (!isFinite(eta)) return null;
  const secs = Math.max(0, Math.round(eta));
  if (secs > 3 * 3600) return null; // too uncertain to show
  return secs;
}

/**
 * Returns the "taking too long" warning threshold in milliseconds based on the
 * requested video duration.
 *
 * - "full" / 90 s / 120 s → 25 min  (long-video tier)
 * - Shorter durations scale proportionally from the 90 s tier down to a 5 min floor
 *   so that a 30 s job doesn't wait 25 minutes before surfacing a warning.
 */
function getThresholdMs(requestedDuration: string | null | undefined): number {
  const LONG_MIN = 25;
  const FLOOR_MIN = 5;
  const LONG_TIER_SEC = 90;
  if (!requestedDuration || requestedDuration === "full") {
    return LONG_MIN * 60_000;
  }
  const durSec = parseInt(requestedDuration, 10);
  if (isNaN(durSec) || durSec <= 0) return LONG_MIN * 60_000;
  if (durSec >= LONG_TIER_SEC) return LONG_MIN * 60_000;
  const minutes = Math.max(FLOOR_MIN, Math.round((LONG_MIN * durSec) / LONG_TIER_SEC));
  return minutes * 60_000;
}

export default function JobStatus() {
  const [match, params] = useRoute("/jobs/:id");
  const id = params?.id;
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();

  const sseRef = useRef<EventSource | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);

  useEffect(() => { setWarningDismissed(false); }, [id]);

  const { data: job, isLoading } = useGetJob(id as string, {
    query: {
      enabled: isAuthenticated && !!id,
      queryKey: getGetJobQueryKey(id as string),
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        if (!s || TERMINAL_STATUSES.has(s)) return false;
        return sseConnected ? false : 3000;
      },
    },
  });

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    const es = new EventSource(`/api/jobs/${id}/events`, { withCredentials: true });
    sseRef.current = es;
    es.onopen = () => setSseConnected(true);
    es.onmessage = (evt) => {
      try {
        const updated = JSON.parse(evt.data);
        // Merge instead of replace so REST-provided fields like videoUrl are not lost
        queryClient.setQueryData(getGetJobQueryKey(id), (old: unknown) =>
          old && typeof old === "object" ? { ...(old as object), ...updated } : updated
        );
        if (TERMINAL_STATUSES.has(updated.status)) { es.close(); setSseConnected(false); }
      } catch {}
    };
    es.onerror = () => { es.close(); setSseConnected(false); };
    return () => { es.close(); setSseConnected(false); };
  }, [isAuthenticated, id, queryClient]);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      setLocation(`/login?from=${returnTo}`);
    }
  }, [isAuthenticated, isAuthLoading, setLocation]);

  const handleRetry = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/jobs/${id}/retry`, { method: "POST", credentials: "include" });
      if (res.ok) queryClient.setQueryData(getGetJobQueryKey(id), await res.json());
    } catch {}
  };

  const elapsed = useElapsed(
    (job as { createdAt?: string | null } | undefined)?.createdAt,
    !!(job && !TERMINAL_STATUSES.has(job.status ?? "")),
  );

  const durVal = (job as { requestedDuration?: string | null } | undefined)?.requestedDuration;
  const jobIsActive = !!(job && !TERMINAL_STATUSES.has(job.status ?? ""));
  const wallElapsedMs = useWallElapsedMs(
    (job as { createdAt?: string | null } | undefined)?.createdAt,
    jobIsActive,
  );
  const thresholdMs = getThresholdMs(durVal);
  const showSlowWarning = jobIsActive && !warningDismissed && wallElapsedMs >= thresholdMs;

  const etaSeconds = useEtaSeconds(
    Math.max(0, Math.min(100, (job as { progressPercent?: number | null } | undefined)?.progressPercent ?? 0)),
    jobIsActive,
  );

  if (isAuthLoading || !isAuthenticated || !id) return null;

  if (isLoading && !job) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Job not found</h1>
        <p className="text-muted-foreground mb-6">This job may have been deleted or the link is incorrect.</p>
        <Button variant="outline" onClick={() => setLocation("/dashboard")}>Back to Dashboard</Button>
      </div>
    );
  }

  const isComplete = job.status === "ready";
  const isFailed = job.status === "failed";
  const autoRetrying = isFailed && isAutoRetrying(job.errorMessage);
  const isActive = !isComplete && !isFailed;
  const displayPercent = isComplete ? 100 : Math.max(0, Math.min(100, job.progressPercent ?? 0));

  const currentStageIdx = STAGES.findIndex((s) => s.key === job.status);
  const currentStage = STAGES[currentStageIdx] ?? STAGES[0];

  const analysis = job.audioAnalysis as Record<string, unknown> | null | undefined;
  // No-audio (prompt-only) jobs store a NULL audio source in the DB ("none"
  // isn't a valid enum value) — detect by the absence of any audio source.
  const jobAudio = job as {
    audioSourceType?: string | null;
    audioObjectPath?: string | null;
    audioSourceUrl?: string | null;
  };
  const noAudioJob =
    (!jobAudio.audioSourceType || jobAudio.audioSourceType === "none") &&
    !jobAudio.audioObjectPath &&
    !jobAudio.audioSourceUrl;
  const errInfo = categoriseError(job.errorMessage);

  // Estimate number of clips for the progress hint
  let numClips = 3;
  if (durVal && durVal !== "full") {
    const d = parseInt(durVal, 10);
    const clipSec = d <= 5 ? 5 : 10;
    numClips = Math.max(1, Math.ceil(d / clipSec));
  }
  const clipHint = inferClipProgress(job.status ?? "", displayPercent, { numClips });
  const previewClips =
    (job as { previewClips?: Record<string, string> } | undefined)?.previewClips ?? {};
  const showScenePreviews =
    (job.status === "generating" || job.status === "stitching") && numClips > 0;

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <Link href="/dashboard">
          <Button variant="ghost" className="pl-0 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        </Link>
        <Button variant="outline" size="sm" onClick={copyLink} className="gap-2 text-muted-foreground">
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Link2 className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : "Copy link"}
        </Button>
      </div>

      <div className="space-y-8">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              {isComplete ? "Video Ready" : isFailed && !autoRetrying ? "Generation Failed" : "Processing Video"}
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-muted-foreground text-sm">
                Style: <span className="capitalize text-foreground font-medium">{job.style}</span>
              </span>
              {isActive && (
                sseConnected ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-mono text-green-400">
                    <Wifi className="h-3 w-3 shrink-0" />
                    Live · {elapsed}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                    <WifiOff className="h-3 w-3 shrink-0" />
                    {elapsed}
                  </span>
                )
              )}
              {analysis?.bpm != null && (
                <Badge variant="secondary" className="font-mono text-xs">{String(analysis.bpm)} BPM</Badge>
              )}
              {analysis?.mood != null && (
                <Badge variant="outline" className="capitalize text-xs">{String(analysis.mood)}</Badge>
              )}
            </div>
          </div>

          <StatusBadge status={job.status ?? "queued"} autoRetrying={autoRetrying} />
        </div>

        {/* Non-fatal notice: some clips were left out but the video still finished. */}
        {isComplete && job.errorMessage && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">
            {job.errorMessage}
          </div>
        )}

        {/* ── Active: progress card ── */}
        <AnimatePresence>
          {(isActive || autoRetrying) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <Card className="bg-card/50 border-border overflow-hidden">
                <CardContent className="pt-6 space-y-6">

                  {/* Animated progress bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm font-medium">
                      <span className="text-muted-foreground">
                        {clipHint ?? currentStage?.label ?? job.status}
                      </span>
                      <span className="tabular-nums font-mono">{displayPercent}%</span>
                    </div>
                    <div className="relative h-3 rounded-full bg-secondary/60 overflow-hidden">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_100%]"
                        animate={{
                          width: `${displayPercent}%`,
                          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                        }}
                        transition={{
                          width: { duration: 0.6, ease: "easeOut" },
                          backgroundPosition: { duration: 3, repeat: Infinity, ease: "linear" },
                        }}
                      />
                      {/* shimmer overlay */}
                      <motion.div
                        className="absolute inset-y-0 w-20 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                        animate={{ left: ["-10%", "110%"] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.5 }}
                      />
                    </div>
                    {etaSeconds != null && (
                      <div className="text-muted-foreground text-right text-xs tabular-nums">
                        about {fmtRemaining(etaSeconds)} remaining
                      </div>
                    )}
                  </div>

                  {/* Stage timeline */}
                  <div className="relative">
                    {/* connector line */}
                    <div className="absolute top-4 left-[10%] right-[10%] h-0.5 bg-border/60 -z-0" />
                    <div className="flex items-start justify-between">
                      {STAGES.filter((s) => s.key !== "queued").map((stage, i) => {
                        const stageIdx = STAGES.findIndex((s) => s.key === stage.key);
                        const done = currentStageIdx > stageIdx;
                        const active = stage.key === job.status;
                        const Icon = stage.icon;
                        return (
                          <div key={stage.key} className="flex flex-col items-center gap-2 flex-1 z-10">
                            <div
                              className={`h-8 w-8 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                                done
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : active
                                    ? "bg-card border-primary text-primary shadow-[0_0_12px_hsl(var(--primary)/0.4)]"
                                    : "bg-card border-border text-muted-foreground"
                              }`}
                            >
                              {done ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : active ? (
                                <motion.div
                                  animate={{ rotate: 360 }}
                                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                </motion.div>
                              ) : (
                                <Icon className="h-3.5 w-3.5" />
                              )}
                            </div>
                            <span
                              className={`text-[10px] text-center leading-tight font-medium ${
                                active ? "text-foreground" : done ? "text-primary" : "text-muted-foreground"
                              }`}
                            >
                              {stage.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Active stage description */}
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={job.status}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="text-xs text-muted-foreground text-center pb-1"
                    >
                      {autoRetrying
                        ? "Automatically retrying after a transient error…"
                        : currentStage?.description}
                    </motion.p>
                  </AnimatePresence>

                  {/* ── Live scene previews: each clip appears here the moment it
                      finishes rendering, well before the final stitch. ── */}
                  {showScenePreviews && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wide text-muted-foreground">
                        <Clapperboard className="h-3.5 w-3.5" />
                        Scenes
                        <span className="text-muted-foreground/60">
                          {Object.keys(previewClips).length}/{numClips}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {Array.from({ length: numClips }).map((_, i) => {
                          const clipUrl = previewClips[String(i)];
                          return (
                            <div
                              key={i}
                              className="relative aspect-video rounded-md overflow-hidden border border-border bg-secondary/40"
                            >
                              {clipUrl ? (
                                <motion.video
                                  initial={{ opacity: 0, scale: 1.03 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.4 }}
                                  src={clipUrl}
                                  className="h-full w-full object-cover"
                                  muted
                                  loop
                                  playsInline
                                  autoPlay
                                />
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <motion.div
                                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
                                    animate={{ x: ["-100%", "100%"] }}
                                    transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                                  />
                                  <span className="text-[10px] font-mono text-muted-foreground/50">
                                    {i + 1}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Slow-job warning ── */}
                  <AnimatePresence>
                    {showSlowWarning && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 flex items-start gap-3"
                      >
                        <TriangleAlert className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-yellow-300 leading-snug">
                            Taking longer than expected
                          </p>
                          <p className="text-xs text-yellow-400/80 mt-0.5 leading-relaxed">
                            This is taking longer than usual. Generation occasionally stalls — if it
                            hasn't moved in a while,{" "}
                            <a
                              href="mailto:support@aibeatSync.com"
                              className="underline underline-offset-2 hover:text-yellow-300 transition-colors"
                            >
                              contact support
                            </a>{" "}
                            and we'll look into it.
                          </p>
                        </div>
                        <button
                          onClick={() => setWarningDismissed(true)}
                          className="text-yellow-400/60 hover:text-yellow-300 transition-colors shrink-0 mt-0.5"
                          aria-label="Dismiss warning"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Failed (not auto-retrying) ── */}
        <AnimatePresence>
          {isFailed && !autoRetrying && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Card className="border-destructive/40 bg-destructive/5">
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="h-10 w-10 rounded-full bg-destructive/15 flex items-center justify-center shrink-0">
                      <ErrorIcon category={errInfo.category} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-destructive mb-1">{errInfo.headline}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{errInfo.detail}</p>

                      {/* Raw error — collapsed by default */}
                      {job.errorMessage && (
                        <details className="mb-4 group">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
                            Show technical details
                          </summary>
                          <pre className="mt-2 text-[11px] bg-secondary/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground leading-relaxed">
                            {job.errorMessage}
                          </pre>
                        </details>
                      )}

                      <div className="flex flex-wrap gap-3">
                        {errInfo.canRetry && (
                          <Button
                            variant="outline"
                            className="border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                            onClick={handleRetry}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" /> Retry this job
                          </Button>
                        )}
                        <Button variant="outline" onClick={() => setLocation("/generate")}>
                          <Plus className="mr-2 h-4 w-4" /> New generation
                        </Button>
                        <Button variant="ghost" onClick={() => setLocation("/dashboard")}>
                          Dashboard
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Complete: video player ── */}
        <AnimatePresence>
          {isComplete && job.videoId && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-2xl border border-primary/30 bg-black overflow-hidden shadow-2xl shadow-primary/10"
            >
              <VideoPlayer jobId={job.id} videoId={job.videoId} videoUrl={(job as unknown as Record<string, unknown>).videoUrl as string | undefined} />
              <DownloadBar jobId={job.id} prompt={job.prompt} />

            </motion.div>
          )}
        </AnimatePresence>

        {isComplete && job.videoId && (
          <div className="flex flex-col items-center gap-2">
            {(job as unknown as { hasAudio?: boolean }).hasAudio === false && (
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                This video was rendered without a soundtrack — add one in the Editor whenever you're ready.
              </p>
            )}
            <Button
              variant={(job as unknown as { hasAudio?: boolean }).hasAudio === false ? "default" : "outline"}
              className="gap-2"
              onClick={async () => {
                const vid = job.videoId!;
                let video = {
                  objectPath: `/objects/videos/${vid}.mp4`,
                  thumbPath: `/objects/thumbnails/${vid}.jpg`,
                  durationSec: 8,
                  name: job.prompt || "Generated video",
                };
                try {
                  const r = await fetch(`/api/videos/${vid}`, { credentials: "include" });
                  if (r.ok) {
                    const data = await r.json();
                    const v = data.video ?? data;
                    if (v?.videoObjectPath) {
                      video = {
                        objectPath: v.videoObjectPath,
                        thumbPath: v.thumbnailObjectPath ?? video.thumbPath,
                        durationSec: v.durationSeconds || 8,
                        name: v.title || job.prompt || "Generated video",
                      };
                    }
                  }
                } catch {
                  /* fall back to constructed paths */
                }
                sessionStorage.setItem("editor:init", JSON.stringify({ video, videoId: vid }));
                setLocation("/editor");
              }}
            >
              {(job as unknown as { hasAudio?: boolean }).hasAudio === false ? (
                <><Music className="h-4 w-4" /> Add Music</>
              ) : (
                <><Scissors className="h-4 w-4" /> Open in Remix Lab</>
              )}
            </Button>
          </div>
        )}

        {/* ── Remix clips ── */}
        {isComplete && job.videoId && (
          <RemixPanel jobId={job.id} requestedDuration={job.requestedDuration} />
        )}

        {/* ── Social exports (TikTok/Shorts teasers + Spotify Canvas) ── */}
        {isComplete && job.videoId && (
          <SocialExportsPanel videoId={job.videoId} />
        )}

        {/* ── Lip sync: animate a face photo singing this video's song ── */}
        {isComplete && job.videoId && !noAudioJob && (
          <LipSyncPanel
            videoId={job.videoId}
            audioDurationSeconds={typeof analysis?.durationSeconds === "number" ? analysis.durationSeconds : undefined}
            initialStartTime={typeof job.clipStartTime === "number" ? job.clipStartTime : 0}
            initialSeconds={typeof analysis?.lipSyncDurationSeconds === "number" ? analysis.lipSyncDurationSeconds : undefined}
          />
        )}

        {/* ── Refer & earn — surfaced right when they've got something to share ── */}
        {isComplete && job.videoId && (
          <ReferEarnCard />
        )}

        {/* ── Audio analysis ── */}
        {analysis && !noAudioJob && (
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-1">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Music className="h-4 w-4 text-primary" /> Audio Profile
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-4">
                    <div>
                      <dt className="text-sm text-muted-foreground">BPM / Tempo</dt>
                      <dd className="text-2xl font-bold font-mono">{analysis.bpm?.toString() ?? "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Musical Key</dt>
                      <dd className="text-lg font-medium">{analysis.key?.toString() ?? "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Detected Mood</dt>
                      <dd className="text-lg font-medium capitalize">{analysis.mood?.toString() ?? "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Duration</dt>
                      <dd className="text-lg font-medium font-mono">
                        {analysis.durationSeconds
                          ? `${Math.floor(Number(analysis.durationSeconds) / 60)}:${(Number(analysis.durationSeconds) % 60).toFixed(2).padStart(5, "0")}`
                          : "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground mb-1">Energy Level</dt>
                      <dd className="flex items-center gap-2">
                        <div className="relative flex-1 h-2 rounded-full bg-secondary/60 overflow-hidden">
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-accent"
                            style={{ width: `${Math.round(Number(analysis.energy ?? 0) * 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium w-8 text-right tabular-nums">
                          {Math.round(Number(analysis.energy ?? 0) * 100)}%
                        </span>
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </div>

            <div className="md:col-span-2">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Track Structure</CardTitle>
                </CardHeader>
                <CardContent>
                  {Array.isArray(analysis.sections) && (analysis.sections as unknown[]).length > 0 ? (
                    <div className="h-[220px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={analysis.sections as Record<string, unknown>[]}
                          margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
                        >
                          <XAxis
                            dataKey="label"
                            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis hide />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              borderColor: "hsl(var(--border))",
                              borderRadius: "8px",
                              fontSize: "12px",
                            }}
                            formatter={(value: number) => [`${Math.round(value * 100)}% energy`, "Intensity"]}
                            labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}
                          />
                          <Bar dataKey="energy" radius={[4, 4, 0, 0]}>
                            {(analysis.sections as Record<string, unknown>[]).map((entry, i) => (
                              <Cell
                                key={`cell-${i}`}
                                fill={
                                  Number(entry.energy) > 0.75
                                    ? "hsl(var(--primary))"
                                    : Number(entry.energy) > 0.5
                                      ? "hsl(var(--accent))"
                                      : "hsl(var(--muted-foreground))"
                                }
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[220px] flex items-center justify-center text-muted-foreground border border-dashed rounded-lg text-sm">
                      Analysis data pending…
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ── Silent-video filler: no real audio to analyse, so swap the fake
             track-structure chart for rotating prompt tips / fun facts / hints. ── */}
        {noAudioJob && isActive && <GenerationFiller />}
      </div>
    </div>
  );
}

function StatusBadge({ status, autoRetrying }: { status: string; autoRetrying: boolean }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-1.5 text-sm font-medium text-green-400">
        <CheckCircle2 className="h-4 w-4" /> Ready
      </span>
    );
  }
  if (status === "pending_approval") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-4 py-1.5 text-sm font-medium text-yellow-400">
        <ShieldAlert className="h-4 w-4" /> Preparing
      </span>
    );
  }
  if (status === "failed" && !autoRetrying) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-1.5 text-sm font-medium text-destructive">
        <AlertCircle className="h-4 w-4" /> Failed
      </span>
    );
  }
  if (autoRetrying) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-4 py-1.5 text-sm font-medium text-yellow-400">
        <RotateCcw className="h-4 w-4 animate-spin" /> Auto-retrying
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary capitalize">
      <Loader2 className="h-4 w-4 animate-spin" /> {status}
    </span>
  );
}

function ErrorIcon({ category }: { category: ErrorCategory }) {
  const cls = "h-5 w-5 text-destructive";
  switch (category) {
    case "api":     return <Server className={cls} />;
    case "audio":   return <FileAudio className={cls} />;
    case "quota":   return <Zap className={cls} />;
    case "timeout": return <WifiOff className={cls} />;
    case "content": return <ShieldAlert className={cls} />;
    default:        return <AlertCircle className={cls} />;
  }
}

function DownloadBar({ jobId, prompt }: { jobId: string; prompt?: string | null }) {
  const [status, setStatus] = useState<"idle" | "downloading" | "error">("idle");

  async function handleDownload() {
    if (status === "downloading") return;
    setStatus("downloading");
    try {
      const r = await fetch(`/api/jobs/${jobId}/video-url`);
      if (!r.ok) throw new Error("url");
      const { url } = await r.json() as { url: string };
      // Fetch video blob directly from GCS — CORS is open (access-control-allow-origin: *)
      const vr = await fetch(url);
      if (!vr.ok) throw new Error("fetch");
      const blob = await vr.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `beatvision-${jobId}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      setStatus("idle");
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <div className="p-4 bg-card flex justify-between items-center border-t border-border gap-3 flex-wrap">
      <div>
        <p className="font-medium text-sm">Your beat-synced video is ready</p>
        <p className="text-xs text-muted-foreground mt-0.5">{prompt?.slice(0, 80)}</p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={status === "downloading"}
        >
          {status === "downloading" ? (
            <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Downloading…</>
          ) : status === "error" ? (
            <><AlertCircle className="mr-1.5 h-4 w-4 text-destructive" /> Failed — retry</>
          ) : (
            <><Download className="mr-1.5 h-4 w-4" /> Download</>
          )}
        </Button>
        <Link href="/gallery">
          <Button className="bg-gradient-electric text-white shadow-glow" size="sm">
            View Gallery
          </Button>
        </Link>
      </div>
    </div>
  );
}

function VideoPlayer({ jobId, videoId, videoUrl: initialVideoUrl }: { jobId: string; videoId: string; videoUrl?: string }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(initialVideoUrl ?? null);
  const [errored, setErrored] = useState(false);
  const posterSrc = `/api/storage/objects/thumbnails/${videoId}.jpg`;
  const fallbackHref = `/api/jobs/${jobId}/video`;

  useEffect(() => {
    if (initialVideoUrl) return;
    let cancelled = false;
    fetch(`/api/jobs/${jobId}/video-url`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<{ url: string }>;
      })
      .then((data) => {
        if (!cancelled) setVideoUrl(data.url);
      })
      .catch(() => {
        if (!cancelled) setErrored(true);
      });
    return () => { cancelled = true; };
  }, [jobId, initialVideoUrl]);

  if (errored) {
    return (
      <div className="aspect-video bg-black flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">Video could not be loaded.</p>
        <a href={fallbackHref} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
          Try opening directly
        </a>
      </div>
    );
  }

  if (!videoUrl) {
    return (
      <div className="aspect-video bg-black flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="aspect-video relative bg-black">
      <video
        src={videoUrl}
        poster={posterSrc}
        controls
        className="w-full h-full object-contain"
        onError={() => setErrored(true)}
      />
    </div>
  );
}

// ───────────────────────── Remix clips ─────────────────────────

interface RemixClip {
  index: number;
  startTime: number;
  endTime: number;
  durationSec: number;
  prompt: string;
  style: string | null;
}

const REMIX_STYLES = [
  "realistic", "anime", "cinematic", "abstract",
  "neon", "vintage", "fantasy", "documentary",
] as const;

// Mirror of the server's credit math (creditCost.ts): remix cost is per
// regenerated clip (each is its own Runway generation), never the full job.
function estimateRemixCost(
  requestedDuration: string | null | undefined,
  totalClips: number,
  regen: number,
): number {
  const total = Math.max(1, totalClips);
  const r = Math.max(0, Math.min(regen, total));
  if (r === 0) return 0;
  // Each regenerated clip is its own Runway generation: per-clip cost × markup.
  const RUNWAY_USD_PER_SECOND = 0.14, USD_PER_CREDIT = 0.015; // Freeway: $1.40 per 10s clip
  const clipSec = requestedDuration && parseInt(requestedDuration, 10) <= 5 ? 5 : 10;
  const perClip = (clipSec * RUNWAY_USD_PER_SECOND) / USD_PER_CREDIT; // pre-markup
  const markup = total <= 1 ? 2 : 1.5;
  return Math.max(1, Math.ceil(perClip * markup * r));
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function RemixPanel({
  jobId,
  requestedDuration,
}: {
  jobId: string;
  requestedDuration: string | null | undefined;
}) {
  const [, setLocation] = useLocation();
  const [clips, setClips] = useState<RemixClip[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [style, setStyle] = useState<string>("keep");
  const [promptOverride, setPromptOverride] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Karaoke captions burned into the remixed video (moved here from Generate).
  const [videoId, setVideoId] = useState<string | null>(null);
  const [lyricsEnabled, setLyricsEnabled] = useState(false);
  const [lyricsText, setLyricsText] = useState("");
  const [rightsOk, setRightsOk] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/jobs/${jobId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const c = (data?.clips as RemixClip[] | undefined) ?? [];
        setClips(Array.isArray(c) ? [...c].sort((a, b) => a.index - b.index) : []);
        if (typeof data?.videoId === "string") setVideoId(data.videoId);
        // Pre-fill with the lyrics the original render used, if any.
        if (typeof data?.lyricsText === "string" && data.lyricsText.trim()) {
          setLyricsText(data.lyricsText);
          setLyricsEnabled(true);
        }
      })
      .catch(() => !cancelled && setClips([]));
    return () => { cancelled = true; };
  }, [jobId]);

  // Auto-sync: AI listens to this video's track and returns word-timed lyrics.
  const autoSync = async () => {
    if (!videoId || !rightsOk) return;
    setSyncing(true);
    setSyncNote(null);
    setError(null);
    try {
      const res = await fetch(`/api/lyrics/align`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          lyricsText: lyricsText.trim() || undefined,
          acceptCopyright: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Auto-sync failed. Please try again.");
        return;
      }
      if (typeof data?.lrc === "string" && data.lrc.trim()) {
        setLyricsText(data.lrc);
        setSyncNote(
          data?.source === "asr"
            ? "Lyrics transcribed from the audio and timed word-by-word — review and edit below."
            : "Your lyrics are now timed word-by-word to the vocals.",
        );
      } else {
        setError("Auto-sync couldn't detect vocals in this track.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSyncing(false);
    }
  };

  // Older videos generated before clip metadata existed can't be remixed.
  if (clips !== null && clips.length === 0) return null;

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  // Mirror the server: a remix whose output carries burned lyrics (entered or
  // inherited) is charged the lyric-overlay add-on on top of the clip cost.
  const cost =
    estimateRemixCost(requestedDuration, clips?.length ?? 0, selected.size) +
    (selected.size > 0 && lyricsEnabled && lyricsText.trim() ? LYRIC_OVERLAY_COST : 0);

  const regenerate = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/remix`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipIndexes: Array.from(selected),
          style: style === "keep" ? undefined : style,
          promptOverride: promptOverride.trim() || undefined,
          // Enabled → burn these lyrics; disabled → clear any inherited ones.
          lyricsText: lyricsEnabled ? lyricsText.trim() : "",
          acceptCopyright: lyricsEnabled && lyricsText.trim() ? rightsOk : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Could not start the remix. Please try again.");
        setSubmitting(false);
        return;
      }
      // Watch the new remix job progress (the original video stays accessible).
      setLocation(`/jobs/${data.job.id}`);
    } catch {
      setError("Network error — please try again.");
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" /> Remix clips
          </span>
          {!open && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={clips === null}>
              {clips === null ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remix a clip"}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick the clips you want to redo. Only those are regenerated — the rest are reused and
            re-stitched with your original audio into a new video. Your current video stays untouched.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {clips?.map((c) => {
              const on = selected.has(c.index);
              return (
                <button
                  key={c.index}
                  type="button"
                  onClick={() => toggle(c.index)}
                  className={`text-left rounded-lg border p-3 transition-colors ${
                    on ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Clapperboard className="h-3.5 w-3.5 text-primary" /> Clip {c.index + 1}
                    </span>
                    {on && <Check className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {fmtTime(c.startTime)}–{fmtTime(c.endTime)}
                  </div>
                  {c.style && (
                    <div className="text-[11px] text-muted-foreground mt-1 capitalize truncate">
                      {c.style}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">New style (optional)</label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="keep">Keep original style</option>
                {REMIX_STYLES.map((s) => (
                  <option key={s} value={s} className="capitalize">{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Prompt override (optional)</label>
              <textarea
                value={promptOverride}
                onChange={(e) => setPromptOverride(e.target.value.slice(0, 1000))}
                placeholder="Describe what these clips should show instead…"
                rows={2}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>

          {/* ── Karaoke captions (burned into the remixed video) ── */}
          <div className="rounded-lg border border-border bg-background/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">Lyric video · karaoke captions</p>
                <p className="text-xs text-muted-foreground">
                  Burn lyrics onto the new video — words fill in as they're sung.
                </p>
              </div>
              <Switch checked={lyricsEnabled} onCheckedChange={setLyricsEnabled} />
            </div>

            {lyricsEnabled && (
              <div className="space-y-3">
                <textarea
                  value={lyricsText}
                  onChange={(e) => setLyricsText(e.target.value.slice(0, 5000))}
                  placeholder="Paste your lyrics here — or leave empty and hit Auto-sync to transcribe them from the track. LRC with [mm:ss] timestamps works too…"
                  rows={5}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none"
                  data-testid="textarea-remix-lyrics"
                />
                <div className="flex items-center justify-between gap-3">
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
                      data-testid="button-remix-lyrics-sample"
                    >
                      Try a sample
                    </button>
                  )}
                </div>
                <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rightsOk}
                    onChange={(e) => setRightsOk(e.target.checked)}
                    className="mt-0.5"
                    data-testid="checkbox-remix-rights"
                  />
                  <span>I confirm I have the rights to this song and its lyrics.</span>
                </label>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    {syncNote ??
                      (!rightsOk
                        ? "Tick the rights box above to enable Auto-sync (2 credits)."
                        : /\[\d{1,2}:\d{2}/.test(lyricsText)
                          ? "Timestamps detected — already synced."
                          : "Auto-sync listens to the track and times each word (2 credits). Leave the box empty to transcribe the lyrics too.")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={autoSync}
                    disabled={syncing || !rightsOk || !videoId}
                    className="gap-2"
                    data-testid="button-remix-autosync"
                  >
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {syncing ? "Listening to the track…" : "Auto-sync to vocals"}
                  </Button>
                  <UiTooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label="Auto-sync cost details" className="text-muted-foreground hover:text-foreground transition-colors shrink-0" data-testid="tooltip-remix-autosync-cost">
                        <Info className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px] text-xs">
                      Auto-sync costs {LYRIC_ALIGN_COST} credits each run — AI listens to the track and times every word to the vocals. Remixing with lyrics also adds {LYRIC_OVERLAY_COST} credits to the remix cost for the karaoke burn (included in the total shown).
                    </TooltipContent>
                  </UiTooltip>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm text-muted-foreground">
              {selected.size === 0
                ? "Select at least one clip"
                : <>Regenerating {selected.size} of {clips?.length} clips · <span className="font-medium text-foreground tabular-nums">~{cost} credits</span></>}
            </span>
            <Button
              onClick={regenerate}
              disabled={submitting || selected.size === 0 || (lyricsEnabled && !!lyricsText.trim() && !rightsOk)}
              className="gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Regenerate selected
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
