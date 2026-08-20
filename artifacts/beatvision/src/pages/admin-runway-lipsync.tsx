import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useSEO } from "@/hooks/useSEO";
import { useToast } from "@/hooks/use-toast";
import { presignAndUpload, LipWindowScrubber } from "@/components/admin/LyricSyncStudio";
import { LIPSYNC_MIN_SECONDS, LIPSYNC_MAX_SECONDS, calculateLipsyncCost } from "@/lib/creditPricing";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, ImageIcon, Music, Sparkles, ShieldCheck, AlertTriangle, CheckCircle2, XCircle,
} from "lucide-react";

// Admin-only "Pixazo Lip Sync Generator" — a dedicated, single-video test tool
// for one character performing to a chosen segment of a song. Fixed to Pixazo
// for every generation stage; never offers or falls back to another provider.
// See routes/admin-lipsync.ts (server-side gate + job creation) and
// jobProcessor.ts processRunwayLipSyncJob (the render path this creates a job
// for). Completely separate from the public Generate page, which is
// unaffected by anything on this page.
//
// Client-side gating below is a UX convenience only (redirects a non-admin
// away) — the REAL enforcement is server-side in routes/admin-lipsync.ts,
// which independently re-checks admin status on every request, so a copied
// URL is useless to a non-admin account.

const DURATION_OPTIONS = [5, 10, 15, 20, 30].filter(
  (s) => s >= LIPSYNC_MIN_SECONDS && s <= LIPSYNC_MAX_SECONDS,
);

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "21:9"] as const;

interface StatusResponse {
  engine: "pixazo";
  hasPixazoKey: boolean;
  plainRenderAvailable: boolean;
  lipSyncAvailable: boolean;
  lipSyncUnavailableReason: string | null;
  minSeconds: number;
  maxSeconds: number;
}

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch("/api/admin/runway-lipsync/status", { credentials: "include" });
  if (!res.ok) throw new Error("Could not load AI rendering status");
  return res.json();
}

export default function AdminRunwayLipSync() {
  useSEO({ title: "AI Lip Sync Generator (Admin)", noindex: true });
  const [, setLocation] = useLocation();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.isAdmin ?? false;

  // Client-side redirect for non-admins (UX only — see note above).
  useEffect(() => {
    if (!isAuthLoading && !isAdmin) setLocation("/");
  }, [isAuthLoading, isAdmin, setLocation]);

  const { data: status, isLoading: isStatusLoading } = useQuery({
    queryKey: ["admin", "runway-lipsync", "status"],
    queryFn: fetchStatus,
    enabled: isAdmin,
    staleTime: 30_000,
  });

  // ── Form state ──────────────────────────────────────────────────────────
  const [prompt, setPrompt] = useState("");
  const [character, setCharacter] = useState("");
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number]>("16:9");
  const [lipSyncEnabled, setLipSyncEnabled] = useState(true);
  const [durationSeconds, setDurationSeconds] = useState(15);

  // Character / reference image
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [referenceImagePath, setReferenceImagePath] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const handleImageSelect = useCallback(async (file: File) => {
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setReferenceImagePath(null);
    setIsUploadingImage(true);
    try {
      const objectPath = await presignAndUpload(file);
      setReferenceImagePath(objectPath);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Image upload failed",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setIsUploadingImage(false);
    }
  }, [toast]);

  // Song + segment
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioObjectPath, setAudioObjectPath] = useState<string | null>(null);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [songDuration, setSongDuration] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [clipStartTime, setClipStartTime] = useState(0);
  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);

  const maxStart = Math.max(0, songDuration - durationSeconds);
  useEffect(() => {
    setClipStartTime((t) => Math.min(t, maxStart));
  }, [maxStart]);

  const handleAudioSelect = useCallback(async (file: File) => {
    setAudioName(file.name);
    setAudioObjectPath(null);
    setClipStartTime(0);
    setIsUploadingAudio(true);
    try {
      // Decode real peaks for the scrubber; fall back to a synthetic waveform.
      try {
        const buf = await file.arrayBuffer();
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AC();
        const decoded = await ctx.decodeAudioData(buf);
        setSongDuration(decoded.duration);
        const ch = decoded.getChannelData(0);
        const N = 120;
        const block = Math.floor(ch.length / N);
        const out: number[] = [];
        for (let i = 0; i < N; i++) {
          let peak = 0;
          for (let j = 0; j < block; j += 64) peak = Math.max(peak, Math.abs(ch[i * block + j] || 0));
          out.push(peak);
        }
        const max = Math.max(...out, 0.01);
        setPeaks(out.map((v) => v / max));
        ctx.close();
      } catch {
        setPeaks(Array.from({ length: 120 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 0.5)) * 0.6));
      }
      const objectPath = await presignAndUpload(file);
      setAudioObjectPath(objectPath);
      if (previewAudioRef.current) previewAudioRef.current.src = URL.createObjectURL(file);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Song upload failed",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setIsUploadingAudio(false);
    }
  }, [toast]);

  const seekPreview = useCallback((t: number) => {
    if (previewAudioRef.current) previewAudioRef.current.currentTime = t;
    setNow(t);
  }, []);

  // ── Submit ──────────────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const creditCost = calculateLipsyncCost(durationSeconds);

  const canSubmit =
    !isSubmitting &&
    prompt.trim().length >= 3 &&
    !!referenceImagePath &&
    !isUploadingImage &&
    !isUploadingAudio &&
    (!lipSyncEnabled || !!audioObjectPath) &&
    (status ? (lipSyncEnabled ? status.lipSyncAvailable : status.plainRenderAvailable) : true);

  const handleSubmit = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin/runway-lipsync/jobs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          character: character.trim() || undefined,
          referenceImagePath,
          audioObjectPath: audioObjectPath ?? undefined,
          clipStartTime,
          durationSeconds,
          aspectRatio,
          lipSyncEnabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setLocation(`/jobs/${data.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isAuthLoading || (!isAdmin && !isAuthLoading)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const unavailable = status && lipSyncEnabled && !status.lipSyncAvailable;
  const noKey = status && !status.hasPixazoKey;

  return (
    <div className="container mx-auto px-4 py-6 sm:py-10 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
          <ShieldCheck className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">AI Lip Sync Generator</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Admin-only. Renders a single test video with the configured AI service and no fallback.
          </p>
        </div>
      </div>

      {/* Engine badge — always visible, never a picker. */}
      <div className="mt-4 mb-6 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <Sparkles className="h-3 w-3" /> AI engine · fixed, no fallback
        </span>
        {isStatusLoading ? (
          <span className="text-xs text-muted-foreground">Checking availability…</span>
        ) : noKey ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
            <XCircle className="h-3 w-3" /> AI rendering is not configured
          </span>
        ) : status?.lipSyncAvailable ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-500">
            <CheckCircle2 className="h-3 w-3" /> Audio-driven Lip Sync available
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-500">
            <AlertTriangle className="h-3 w-3" /> Lip Sync unavailable — plain video rendering still works
          </span>
        )}
      </div>

      {status && !status.lipSyncAvailable && status.lipSyncUnavailableReason && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          {status.lipSyncUnavailableReason} This request will remain unavailable until the AI service configuration is restored.
        </div>
      )}

      <div className="grid gap-5 sm:gap-6 p-4 sm:p-6 rounded-2xl bg-card border border-card-border shadow-lg">
        {/* Lip Sync toggle — explicit control, never implied. */}
        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/40 px-4 py-3">
          <div>
            <Label htmlFor="lipsync-toggle" className="text-sm font-medium">Lip Sync</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lipSyncEnabled
                ? "On — one audio-driven video of the character performing to the song segment."
                : "Off — a plain AI render of the character, with the song segment added as a soundtrack."}
            </p>
          </div>
          <Switch id="lipsync-toggle" checked={lipSyncEnabled} onCheckedChange={setLipSyncEnabled} />
        </div>

        {/* Visual prompt */}
        <div>
          <Label htmlFor="prompt">Visual prompt</Label>
          <Textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the scene, styling, and performance — e.g. 'close-up on stage under blue stage lights, singing directly to camera'"
            className="mt-1.5 min-h-[88px]"
          />
        </div>

        {/* Character label (optional, for reference/notes) */}
        <div>
          <Label htmlFor="character">Character (optional label)</Label>
          <Input
            id="character"
            value={character}
            onChange={(e) => setCharacter(e.target.value)}
            placeholder="e.g. lead singer"
            className="mt-1.5"
          />
        </div>

        {/* Character / reference image — required */}
        <div className="rounded-xl border border-border/60 bg-background/30 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <ImageIcon className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium">Character / reference image</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">— required</span>
            </div>
            {referenceImagePath && (
              <button
                onClick={() => {
                  setReferenceImagePath(null);
                  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
                  setImagePreviewUrl(null);
                }}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageSelect(file);
              e.target.value = "";
            }}
          />
          {imagePreviewUrl ? (
            <div className="px-4 pb-4 flex items-center gap-4">
              <div className="relative shrink-0">
                <img src={imagePreviewUrl} alt="Character reference" className="h-20 w-20 rounded-lg object-cover border border-border/40" />
                {isUploadingImage && (
                  <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 text-white animate-spin" />
                  </div>
                )}
              </div>
              <div>
                {isUploadingImage ? (
                  <p className="text-sm font-medium text-muted-foreground">Uploading…</p>
                ) : referenceImagePath ? (
                  <p className="text-sm font-medium text-green-500">Ready</p>
                ) : (
                  <p className="text-sm font-medium text-destructive">Upload failed — try again</p>
                )}
                <button onClick={() => imageInputRef.current?.click()} className="text-xs text-primary hover:underline mt-1">
                  Change image
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 pb-4">
              <Button type="button" variant="outline" size="sm" onClick={() => imageInputRef.current?.click()}>
                Upload character image
              </Button>
            </div>
          )}
        </div>

        {/* Song + segment */}
        <div className="rounded-xl border border-border/60 bg-background/30 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <Music className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium">Song</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                — {lipSyncEnabled ? "required for Lip Sync" : "optional soundtrack"}
              </span>
            </div>
            {audioObjectPath && (
              <button
                onClick={() => {
                  setAudioObjectPath(null);
                  setAudioName(null);
                  setPeaks([]);
                  setSongDuration(0);
                }}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAudioSelect(file);
              e.target.value = "";
            }}
          />
          <div className="px-4 pb-4">
            {!audioName ? (
              <Button type="button" variant="outline" size="sm" onClick={() => audioInputRef.current?.click()}>
                Upload song
              </Button>
            ) : (
              <>
                <p className="text-sm font-medium mb-2">
                  {audioName} {isUploadingAudio && <span className="text-muted-foreground">— uploading…</span>}
                </p>
                <audio ref={previewAudioRef} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} className="hidden" />
                {songDuration > 0 && (
                  <>
                    <LipWindowScrubber
                      duration={songDuration}
                      peaks={peaks}
                      windowStart={clipStartTime}
                      windowSeconds={durationSeconds}
                      now={now}
                      disabled={maxStart <= 0}
                      onChange={setClipStartTime}
                      onScrub={seekPreview}
                    />
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-muted-foreground">
                        Segment: {clipStartTime.toFixed(1)}s – {(clipStartTime + durationSeconds).toFixed(1)}s of {songDuration.toFixed(1)}s — drag to move
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (previewAudioRef.current) {
                            previewAudioRef.current.currentTime = clipStartTime;
                            void previewAudioRef.current.play();
                          }
                        }}
                      >
                        Preview
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Duration + aspect ratio */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Duration</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {DURATION_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDurationSeconds(s)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    durationSeconds === s
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/60 bg-secondary/40 hover:border-primary/40 hover:bg-secondary/70"
                  }`}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Aspect ratio</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setAspectRatio(r)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    aspectRatio === r
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border/60 bg-secondary/40 hover:border-primary/40 hover:bg-secondary/70"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {submitError && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <XCircle className="h-4 w-4 shrink-0" /> {submitError}
          </p>
        )}
        {unavailable && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-500">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Lip Sync isn't available right now — turn it off to render a plain test, or restore the AI service configuration.
          </p>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            Estimated cost: <span className="font-medium text-foreground">{creditCost} credits</span> (admins are metered but never blocked)
          </p>
          <Button type="button" disabled={!canSubmit} onClick={handleSubmit} className="min-w-[140px]">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
