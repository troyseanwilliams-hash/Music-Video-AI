import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useGetJob, getGetJobQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Music, CheckCircle2, AlertCircle, ArrowLeft,
  Play, RefreshCw, Download, ExternalLink,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { motion } from "framer-motion";

const TERMINAL_STATUSES = new Set(["ready", "failed"]);

const STATUS_STEPS = [
  { key: "queued",     label: "In Queue",        pct: 0   },
  { key: "analyzing",  label: "Analyzing Audio",  pct: 20  },
  { key: "generating", label: "Generating Clips", pct: 50  },
  { key: "stitching",  label: "Stitching Video",  pct: 85  },
  { key: "ready",      label: "Complete",         pct: 100 },
];

export default function JobStatus() {
  const [match, params] = useRoute("/jobs/:id");
  const id = params?.id;
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();

  const sseRef = useRef<EventSource | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

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
        queryClient.setQueryData(getGetJobQueryKey(id), updated);
        if (TERMINAL_STATUSES.has(updated.status)) {
          es.close();
          setSseConnected(false);
        }
      } catch {}
    };
    es.onerror = () => { es.close(); setSseConnected(false); };
    return () => { es.close(); setSseConnected(false); };
  }, [isAuthenticated, id, queryClient]);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthenticated, isAuthLoading, setLocation]);

  const handleRetry = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/jobs/${id}/retry`, { method: "POST", credentials: "include" });
      if (res.ok) {
        const updated = await res.json();
        queryClient.setQueryData(getGetJobQueryKey(id), updated);
      }
    } catch {}
  };

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
        <h1 className="text-2xl font-bold">Job not found</h1>
        <Button variant="link" onClick={() => setLocation("/dashboard")}>Back to Dashboard</Button>
      </div>
    );
  }

  const isComplete = job.status === "ready";
  const isFailed = job.status === "failed";
  const isActive = !isComplete && !isFailed;
  const displayPercent = isComplete ? 100 : (job.progressPercent ?? 0);
  const currentStepIndex = STATUS_STEPS.findIndex((s) => s.key === job.status);

  const analysis = job.audioAnalysis as Record<string, unknown> | null | undefined;
  const videoPath = analysis ? null : null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Link href="/dashboard">
        <Button variant="ghost" className="mb-6 pl-0 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </Link>

      <div className="space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              {isComplete ? "Video Ready" : isFailed ? "Generation Failed" : "Processing Video"}
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-muted-foreground">
                Style: <span className="capitalize text-foreground font-medium">{job.style}</span>
              </span>
              {sseConnected && (
                <span className="inline-flex items-center gap-1.5 text-xs text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live
                </span>
              )}
              {analysis?.bpm && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {String(analysis.bpm)} BPM
                </Badge>
              )}
              {analysis?.mood && (
                <Badge variant="outline" className="capitalize text-xs">
                  {String(analysis.mood)}
                </Badge>
              )}
            </div>
          </div>

          <div className="inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-medium capitalize bg-card">
            {isComplete ? (
              <><CheckCircle2 className="mr-2 h-4 w-4 text-green-500" /> Ready</>
            ) : isFailed ? (
              <><AlertCircle className="mr-2 h-4 w-4 text-destructive" /> Failed</>
            ) : (
              <><Loader2 className="mr-2 h-4 w-4 text-primary animate-spin" /> {job.status}</>
            )}
          </div>
        </div>

        {isActive && (
          <Card className="bg-card/50">
            <CardContent className="pt-6 space-y-5">
              <div>
                <div className="flex justify-between text-sm font-medium mb-2">
                  <span className="text-muted-foreground capitalize">
                    {STATUS_STEPS[currentStepIndex]?.label ?? job.status}
                  </span>
                  <span>{displayPercent}%</span>
                </div>
                <Progress value={displayPercent} className="h-3" />
              </div>

              <div className="flex items-center justify-between pt-1">
                {STATUS_STEPS.filter((s) => s.key !== "queued").map((step) => {
                  const stepIdx = STATUS_STEPS.findIndex((s) => s.key === step.key);
                  const done = currentStepIndex > stepIdx;
                  const active = step.key === job.status;
                  return (
                    <div key={step.key} className="flex flex-col items-center gap-1.5 flex-1">
                      <div
                        className={`h-2 w-2 rounded-full transition-colors ${
                          done ? "bg-primary" : active ? "bg-primary animate-pulse" : "bg-border"
                        }`}
                      />
                      <span
                        className={`text-[10px] text-center leading-tight ${
                          active ? "text-foreground font-medium" : "text-muted-foreground"
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {job.status === "analyzing" && (
                <p className="text-xs text-muted-foreground text-center">
                  Decoding audio PCM, detecting BPM and song sections…
                </p>
              )}
              {job.status === "generating" && (
                <p className="text-xs text-muted-foreground text-center">
                  Generating beat-synced clips for each song section via AI…
                </p>
              )}
              {job.status === "stitching" && (
                <p className="text-xs text-muted-foreground text-center">
                  Stitching clips, mixing audio{(job as { lyricsText?: string | null }).lyricsText ? ", overlaying lyrics" : ""}…
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {isFailed && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="pt-6 flex items-start gap-4">
              <AlertCircle className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-destructive mb-1">Processing failed</h3>
                <p className="text-sm text-destructive/90 mb-4">
                  {job.errorMessage || "An unknown error occurred during processing."}
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="border-destructive/30 hover:bg-destructive/20"
                    onClick={handleRetry}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Retry Job
                  </Button>
                  <Button variant="outline" onClick={() => setLocation("/generate")}>
                    New Generation
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isComplete && job.videoId && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl border border-primary/30 bg-black overflow-hidden shadow-2xl shadow-primary/10"
          >
            <VideoPlayer videoId={job.videoId} />
            <div className="p-4 bg-card flex justify-between items-center border-t border-border gap-3 flex-wrap">
              <div>
                <p className="font-medium text-sm">Your beat-synced video is ready</p>
                <p className="text-xs text-muted-foreground mt-0.5">{job.prompt?.slice(0, 80)}</p>
              </div>
              <div className="flex gap-2">
                <a href={`/api/jobs/${job.id}/video`} download target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    <Download className="mr-1.5 h-4 w-4" /> Download
                  </Button>
                </a>
                <Link href="/gallery">
                  <Button className="bg-gradient-electric text-white shadow-glow" size="sm">
                    View Gallery
                  </Button>
                </Link>
              </div>
            </div>
          </motion.div>
        )}

        {analysis && (
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Music className="h-4 w-4 text-primary" />
                    Audio Profile
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-4">
                    <div>
                      <dt className="text-sm text-muted-foreground">BPM / Tempo</dt>
                      <dd className="text-2xl font-bold font-mono">
                        {analysis.bpm?.toString() ?? "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Musical Key</dt>
                      <dd className="text-lg font-medium">{analysis.key?.toString() ?? "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Detected Mood</dt>
                      <dd className="text-lg font-medium capitalize">
                        {analysis.mood?.toString() ?? "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Duration</dt>
                      <dd className="text-lg font-medium font-mono">
                        {analysis.durationSeconds
                          ? `${Math.floor(Number(analysis.durationSeconds) / 60)}:${String(Math.floor(Number(analysis.durationSeconds) % 60)).padStart(2, "0")}`
                          : "N/A"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Energy Level</dt>
                      <dd className="flex items-center gap-2 mt-1">
                        <Progress
                          value={Number(analysis.energy ?? 0) * 100}
                          className="flex-1 h-2"
                        />
                        <span className="text-sm font-medium w-8 text-right">
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
                            formatter={(value: number) => [
                              `${Math.round(value * 100)}% energy`,
                              "Intensity",
                            ]}
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

function VideoPlayer({ videoId }: { videoId: string }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const videoSrc = `/api/storage/objects/videos/${videoId}.mp4`;

  const handlePlay = () => {
    setPlaying(true);
    setTimeout(() => videoRef.current?.play(), 50);
  };

  return (
    <div className="aspect-video relative bg-black flex items-center justify-center">
      {playing ? (
        <video
          ref={videoRef}
          src={videoSrc}
          controls
          autoPlay
          className="w-full h-full object-contain"
          onError={() => setPlaying(false)}
        />
      ) : (
        <div className="w-full h-full relative flex items-center justify-center">
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <button
            onClick={handlePlay}
            className="relative z-10 h-20 w-20 rounded-full bg-primary/90 hover:bg-primary flex items-center justify-center shadow-2xl transition-all hover:scale-105 group"
            aria-label="Play video"
          >
            <Play className="h-9 w-9 text-white ml-1 group-hover:scale-110 transition-transform" />
          </button>
          <div className="absolute bottom-4 right-4 z-10">
            <a
              href={videoSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors"
            >
              <ExternalLink className="h-3 w-3" /> Open in new tab
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
