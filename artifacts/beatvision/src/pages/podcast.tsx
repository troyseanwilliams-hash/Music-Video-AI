import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { formatMediaDuration, normalizePodcastHighlights, podcastMediaUrl } from "@/lib/podcastMedia";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  AlertCircle, CheckCircle2, Download, FileAudio, FileVideo, Loader2,
  Mic2, Sparkles, Upload, Video,
} from "lucide-react";

type PodcastJob = {
  id: string;
  title: string;
  status: string;
  progress?: number;
  error?: string;
  durationSeconds?: number;
  transcript?: string;
  highlights?: unknown;
  fullVideoPath?: string;
  previewPath?: string;
  thumbnailPath?: string;
  clipPaths?: string[];
  createdAt?: string;
};

const terminalStatuses = new Set(["ready", "failed", "completed"]);
const MAX_PODCAST_BYTES = 250 * 1024 * 1024;
const PODCAST_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac", "mp4"]);
const PODCAST_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a",
  "audio/aac", "audio/ogg", "application/ogg", "audio/flac", "audio/x-flac", "video/mp4",
]);
const PODCAST_ACCEPT = [
  ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".mp4",
  ...PODCAST_MIME_TYPES,
].join(",");

function friendlyError(error?: string): string {
  if (!error) return "We couldn't complete this episode. Please try again or contact support if the problem continues.";
  if (/file|format|audio|video/i.test(error)) return "We couldn't read this file. Try a supported audio file or MP4 and upload it again.";
  if (/limit|large|size/i.test(error)) return "This file is too large for this upload. Choose a smaller file and try again.";
  return "We couldn't complete this episode. Please try again or contact support if the problem continues.";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "Queued", uploading: "Uploading", analyzing: "Transcribing",
    processing: "Producing media", generating: "Producing media", stitching: "Finishing video",
    ready: "Ready", completed: "Ready", failed: "Needs attention",
  };
  return labels[status.toLowerCase()] ?? "Preparing";
}

export default function Podcast() {
  const [match, params] = useRoute("/podcast/:id");
  const jobId = match ? params?.id : undefined;
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [objectPath, setObjectPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation(`/login?from=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [authLoading, isAuthenticated, setLocation]);

  const jobQuery = useQuery({
    queryKey: ["podcast-job", jobId],
    enabled: isAuthenticated && Boolean(jobId),
    queryFn: async () => {
      const response = await fetch(`/api/podcast/jobs/${encodeURIComponent(jobId!)}`, { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("This podcast episode is unavailable.");
      return data as PodcastJob;
    },
    refetchInterval: (query) => terminalStatuses.has(query.state.data?.status ?? "") ? false : 3000,
  });

  const uploadFile = async (file?: File) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !PODCAST_EXTENSIONS.has(extension) || (file.type && !PODCAST_MIME_TYPES.has(file.type.toLowerCase()))) {
      setFormError("Choose a supported MP3, WAV, M4A, AAC, OGG, FLAC, or MP4 file.");
      return;
    }
    if (file.size > MAX_PODCAST_BYTES) {
      setFormError("Podcast media must be 250 MB or smaller.");
      return;
    }
    const contentType = file.type || (extension === "mp4" ? "video/mp4" : "application/octet-stream");
    setUploading(true); setUploadProgress(0); setFormError(null); setFileName(file.name);
    try {
      const response = await fetch("/api/storage/uploads/request-url", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType }),
      });
      const upload = await response.json().catch(() => ({}));
      if (!response.ok || !upload.uploadURL || !upload.objectPath) throw new Error("Could not prepare your upload.");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (event) => event.lengthComputable && setUploadProgress(Math.round(event.loaded / event.total * 100));
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed."));
        xhr.onerror = () => reject(new Error("Upload failed."));
        xhr.open("PUT", upload.uploadURL); xhr.setRequestHeader("Content-Type", contentType); xhr.send(file);
      });
      setObjectPath(upload.objectPath); setUploadProgress(100);
      toast({ title: "Media uploaded", description: "Your episode is ready to package." });
    } catch {
      setFileName(""); setObjectPath(null); setFormError("Your upload didn't finish. Please check your connection and try again.");
    } finally { setUploading(false); }
  };

  const submit = async () => {
    if (!objectPath) { setFormError("Upload an audio file or MP4 before creating your package."); return; }
    if (!title.trim()) { setFormError("Add an episode title before creating your package."); return; }
    setSubmitting(true); setFormError(null);
    trackEvent("creation_started", { creation_type: "podcast", has_audio: true });
    try {
      const response = await fetch("/api/podcast/jobs", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), audioObjectPath: objectPath }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.jobId !== "string") throw new Error();
      trackEvent("creation_accepted", { creation_type: "podcast" });
      setLocation(`/podcast/${encodeURIComponent(data.jobId)}`);
    } catch {
      setFormError("We couldn't start your package. Your uploaded file is still private; please try again.");
    } finally { setSubmitting(false); }
  };

  if (authLoading || !isAuthenticated) return null;
  if (jobId) return <PodcastResults job={jobQuery.data} loading={jobQuery.isLoading} error={jobQuery.isError} onNew={() => setLocation("/podcast")} />;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-10 sm:py-16">
      <div className="mb-10 max-w-3xl">
        <Badge className="mb-4 gap-1.5"><Mic2 className="h-3.5 w-3.5" /> Podcast Media</Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Turn one episode into ready-to-share media.</h1>
        <p className="mt-4 text-lg text-muted-foreground">AIBeatSync packages your episode with a transcript, captioned full video, and three vertical highlights.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
        <Card>
          <CardHeader><CardTitle>Create a podcast package</CardTitle><CardDescription>Upload media you own or are authorized to use.</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2"><Label htmlFor="podcast-title">Episode title</Label><Input id="podcast-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Building a better creative practice" maxLength={160} /></div>
            <div className="space-y-2">
              <Label>Episode media</Label>
               <input ref={inputRef} className="sr-only" type="file" accept={PODCAST_ACCEPT} onChange={(e) => void uploadFile(e.target.files?.[0])} />
              <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed border-primary/40 bg-primary/5 p-5 text-center transition-colors hover:bg-primary/10 disabled:cursor-not-allowed">
                {uploading ? <Loader2 className="mb-2 h-6 w-6 animate-spin text-primary" /> : objectPath ? <CheckCircle2 className="mb-2 h-6 w-6 text-primary" /> : <Upload className="mb-2 h-6 w-6 text-primary" />}
                <span className="font-medium">{uploading ? "Uploading media…" : objectPath ? fileName : "Choose audio or MP4"}</span>
                 <span className="mt-1 text-sm text-muted-foreground">MP3, WAV, M4A, AAC, OGG, FLAC, or MP4</span>
              </button>
               <p className="text-xs text-muted-foreground">Maximum 250 MB · 90-second minimum · 3-hour maximum</p>
              {uploading && <Progress value={uploadProgress} aria-label={`Upload ${uploadProgress}%`} />}
            </div>
            {formError && <p role="alert" className="flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{formError}</p>}
            <Button className="w-full bg-gradient-electric text-white shadow-glow hover:opacity-90" disabled={uploading || submitting} onClick={() => void submit()}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create media package</Button>
          </CardContent>
        </Card>
        <Card className="bg-secondary/30"><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Included in your package</CardTitle></CardHeader><CardContent><ul className="space-y-4 text-sm"><li className="flex gap-3"><FileAudio className="h-5 w-5 text-primary" /><span><strong className="block text-foreground">Episode transcript</strong>Readable text for your review and reuse.</span></li><li className="flex gap-3"><Video className="h-5 w-5 text-primary" /><span><strong className="block text-foreground">Captioned full episode</strong>A shareable video version of your episode.</span></li><li className="flex gap-3"><Sparkles className="h-5 w-5 text-primary" /><span><strong className="block text-foreground">Three vertical highlights</strong>Each with a suggested title and description.</span></li></ul></CardContent></Card>
      </div>
    </div>
  );
}

function PodcastResults({ job, loading, error, onNew }: { job?: PodcastJob; loading: boolean; error: boolean; onNew: () => void }) {
  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (error || !job) return <div className="container mx-auto max-w-3xl px-4 py-16 text-center"><AlertCircle className="mx-auto mb-4 h-10 w-10 text-muted-foreground" /><h1 className="text-2xl font-bold">Episode not found</h1><p className="mt-2 text-muted-foreground">It may have been removed or this link is incorrect.</p><Button className="mt-6" onClick={onNew}>Create a package</Button></div>;
  const ready = job.status === "ready" || job.status === "completed";
  const failed = job.status === "failed";
  const highlights = normalizePodcastHighlights(job.highlights).map((highlight, index) => ({ ...highlight, path: ready ? highlight.path ?? job.clipPaths?.[index] : undefined }));
  const preview = ready ? podcastMediaUrl(job.previewPath ?? job.fullVideoPath) : undefined;
  const percent = ready ? 100 : Math.max(0, Math.min(100, job.progress ?? 0));
  return <div className="container mx-auto max-w-6xl px-4 py-10 sm:py-14">
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4"><div><Link href="/podcast" className="text-sm text-primary hover:underline">← Podcast Media</Link><h1 className="mt-2 text-3xl font-bold">{job.title}</h1><p className="mt-2 text-muted-foreground">{job.durationSeconds ? `${formatMediaDuration(job.durationSeconds)} episode` : "Podcast media package"}</p></div><Button variant="outline" onClick={onNew}>New package</Button></div>
     {failed ? <Card className="mb-8 border-destructive/40"><CardContent className="flex gap-3 p-6"><AlertCircle className="h-5 w-5 shrink-0 text-destructive" /><div><h2 className="font-semibold">This package needs attention</h2><p className="mt-1 text-sm text-muted-foreground">{friendlyError(job.error)}</p></div></CardContent></Card> : !ready ? <Card className="mb-8"><CardContent className="p-6"><div className="mb-3 flex justify-between gap-4"><span className="font-medium">{statusLabel(job.status)}</span><span className="text-sm text-muted-foreground">{percent}%</span></div><Progress value={percent} /><p className="mt-3 text-sm text-muted-foreground">You can leave this page; processing will continue. Your transcript and highlight suggestions may appear while the private media files are still rendering.</p></CardContent></Card> : <Card className="mb-8 border-primary/30 bg-primary/5"><CardContent className="flex gap-3 p-5"><CheckCircle2 className="h-5 w-5 shrink-0 text-primary" /><p><strong>Your package is ready.</strong> Review the transcript and download the media below.</p></CardContent></Card>}
    {ready && preview && <Card className="mb-8 overflow-hidden"><CardHeader><CardTitle>Full episode video</CardTitle></CardHeader><CardContent><video className="aspect-video w-full rounded-lg bg-black" controls poster={podcastMediaUrl(job.thumbnailPath)} src={preview} /><DownloadLink path={job.fullVideoPath} label="Download full episode" /></CardContent></Card>}
     <div className="grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle>Transcript</CardTitle><CardDescription>{job.transcript ? ready ? "Your episode transcription" : "Your transcript is ready while media rendering continues." : ready ? "Transcript is not available for this episode." : "The transcript may appear here before media rendering finishes."}</CardDescription></CardHeader>{job.transcript && <CardContent><div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-secondary/50 p-4 text-sm leading-6">{job.transcript}</div></CardContent>}</Card><Card><CardHeader><CardTitle>Vertical highlights</CardTitle><CardDescription>{ready ? "Three short-form cuts with suggested copy." : "Highlight suggestions may appear while their media files are still rendering."}</CardDescription></CardHeader><CardContent className="space-y-3">{highlights.length ? highlights.map((h, i) => <div key={h.id} className="rounded-lg border border-border/60 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-medium">{h.title}</h3>{h.startSeconds !== undefined && <Badge variant="secondary">{formatMediaDuration(h.startSeconds)}{h.endSeconds !== undefined ? `–${formatMediaDuration(h.endSeconds)}` : ""}</Badge>}</div>{h.description && <p className="mt-2 text-sm text-muted-foreground">{h.description}</p>}<DownloadLink path={h.path} label={`Download highlight ${i + 1}`} /></div>) : <p className="text-sm text-muted-foreground">No highlights are available yet.</p>}</CardContent></Card></div>
  </div>;
}

function DownloadLink({ path, label }: { path?: string; label: string }) {
  const url = podcastMediaUrl(path);
  if (!url) return null;
  return <a href={url} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" onClick={() => trackEvent("export_downloaded", { export_type: "podcast" })}><Download className="h-4 w-4" />{label}</a>;
}