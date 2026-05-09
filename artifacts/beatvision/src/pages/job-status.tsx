import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useGetJob, getGetJobQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Music, CheckCircle2, AlertCircle, ArrowLeft,
  Play, RefreshCw, Download, ExternalLink, Clock,
  AudioWaveform, Clapperboard, Scissors, Sparkles, RotateCcw,
  WifiOff, Wifi, FileAudio, Server, Zap, Plus, Link2, Check, ShieldAlert,
  TriangleAlert, X,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { motion, AnimatePresence } from "framer-motion";

const TERMINAL_STATUSES = new Set(["ready", "failed"]);

const STAGES = [
  {
    key: "pending_approval",
    label: "Awaiting Approval",
    icon: ShieldAlert,
    description: "Waiting for admin approval before processing begins…",
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
    description: "Creating AI video clips for each beat section via Runway Gen-4.5…",
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
      detail: "The Runway API returned an unexpected response. This is usually transient — retrying often fixes it.",
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

function useElapsed(active: boolean): string {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) { setSecs(0); return; }
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
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
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
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

  const elapsed = useElapsed(!!(job && !TERMINAL_STATUSES.has(job.status ?? "")));

  const durVal = (job as { requestedDuration?: string | null } | undefined)?.requestedDuration;
  const jobIsActive = !!(job && !TERMINAL_STATUSES.has(job.status ?? ""));
  const wallElapsedMs = useWallElapsedMs(
    (job as { createdAt?: string | null } | undefined)?.createdAt,
    jobIsActive,
  );
  const thresholdMs = getThresholdMs(durVal);
  const showSlowWarning = jobIsActive && !warningDismissed && wallElapsedMs >= thresholdMs;

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
  const errInfo = categoriseError(job.errorMessage);

  // Estimate number of clips for the progress hint
  let numClips = 3;
  if (durVal && durVal !== "full") {
    const d = parseInt(durVal, 10);
    const clipSec = d <= 5 ? 5 : 10;
    numClips = Math.max(1, Math.ceil(d / clipSec));
  }
  const clipHint = inferClipProgress(job.status ?? "", displayPercent, { numClips });

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
              <VideoPlayer jobId={job.id} videoId={job.videoId} videoUrl={(job as Record<string, unknown>).videoUrl as string | undefined} />
              <DownloadBar jobId={job.id} prompt={job.prompt} />

            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Audio analysis ── */}
        {analysis && (
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
        <ShieldAlert className="h-4 w-4" /> Awaiting Approval
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
