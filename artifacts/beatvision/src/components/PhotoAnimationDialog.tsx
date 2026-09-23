import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Link } from "wouter";
import { Check, ExternalLink, Loader2, Sparkles, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  clearPendingPhotoAnimation,
  clearPhotoAnimationOperationIntent,
  newIdempotencyKey,
  readPendingPhotoAnimation,
  readPhotoAnimationOperationIntent,
  photoAnimationRequestFingerprint,
  photoAnimationSourceKey,
  matchesPhotoAnimationOperation,
  isUnambiguousPhotoAnimationRejection,
  samePhotoAnimationInput,
  writePendingPhotoAnimation,
  writePhotoAnimationOperationIntent,
  type PhotoAnimationInput,
  type PhotoAnimationOperationIntent,
  type PhotoAnimationQuote,
  type PhotoAnimationSource,
} from "@/lib/photoAnimation";

const PRESETS = [
  { label: "Gentle push in", prompt: "A gentle cinematic camera push in with subtle natural movement." },
  { label: "Slow pan", prompt: "A slow cinematic camera pan with subtle natural movement in the scene." },
  { label: "Living portrait", prompt: "Subtle lifelike motion, natural blinking and breathing, with a steady camera." },
  { label: "Dreamy drift", prompt: "A dreamy floating camera drift with soft environmental motion." },
] as const;

type JobState = { id?: string; status?: string };

export function PhotoAnimationDialog({
  open,
  onOpenChange,
  source,
  imageUrl,
  userId,
  initialAspectRatio = "9:16",
  onCompleted,
  onJobStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: PhotoAnimationSource;
  imageUrl: string;
  userId: string;
  initialAspectRatio?: PhotoAnimationInput["aspectRatio"];
  onCompleted?: (jobId: string) => void;
  onJobStarted?: (jobId: string) => void;
}) {
  const [prompt, setPrompt] = useState<string>(PRESETS[0].prompt);
  const [durationSeconds, setDuration] = useState<5 | 10>(5);
  const [provider, setProvider] = useState<"kling" | "runway">("kling");
  const resolution = "720p" as const;
  const [aspectRatio, setAspectRatio] = useState<PhotoAnimationInput["aspectRatio"]>(initialAspectRatio);
  const [quote, setQuote] = useState<PhotoAnimationQuote | null>(null);
  const [quotedInput, setQuotedInput] = useState<PhotoAnimationInput | null>(null);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState<"quote" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [operationIntent, setOperationIntent] = useState<PhotoAnimationOperationIntent | null>(null);
  const [recoveringOperation, setRecoveringOperation] = useState(false);
  const [retryingOriginal, setRetryingOriginal] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const detectedAspect = useRef(false);
  const sourceRef = useRef(source);
  const onCompletedRef = useRef(onCompleted);
  const onJobStartedRef = useRef(onJobStarted);
  const sourceKey = photoAnimationSourceKey(source);
  sourceRef.current = source;
  onCompletedRef.current = onCompleted;
  onJobStartedRef.current = onJobStarted;

  const input = useMemo<PhotoAnimationInput>(() => ({
    source, prompt: prompt.trim(), durationSeconds, provider, resolution, aspectRatio,
  }), [source, prompt, durationSeconds, provider, resolution, aspectRatio]);

  useEffect(() => {
    if (quotedInput && !samePhotoAnimationInput(input, quotedInput)) {
      setQuote(null);
      setQuotedInput(null);
      setApproved(false);
      if (!operationIntent) idempotencyKey.current = newIdempotencyKey();
    }
  }, [input, operationIntent, quotedInput]);

  useEffect(() => {
    detectedAspect.current = false;
    setAspectRatio(initialAspectRatio);
    const currentSource = sourceRef.current;
    const pending = readPendingPhotoAnimation(userId, currentSource);
    if (pending) {
      setJob({ id: pending.jobId, status: "pending" });
      clearPhotoAnimationOperationIntent(userId, currentSource);
      setOperationIntent(null);
      return;
    }
    setJob(null);
    const unresolved = readPhotoAnimationOperationIntent(userId, currentSource);
    setOperationIntent(unresolved);
    if (unresolved) {
      idempotencyKey.current = unresolved.idempotencyKey;
      void recoverOperation(unresolved);
    }
  }, [initialAspectRatio, sourceKey, userId]);

  async function recoverOperation(intent: PhotoAnimationOperationIntent) {
    setRecoveringOperation(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/photo-animations/operations/${encodeURIComponent(intent.idempotencyKey)}`,
        { credentials: "include" },
      );
      let data: { id?: string; status?: string; code?: string; error?: string } = {};
      try {
        data = await response.json();
      } catch {
        throw new Error("Recovery is temporarily unavailable. No new animation will be started.");
      }
      if (response.status === 404 && data.code === "OPERATION_NOT_FOUND") {
        // Absence can race with the original POST before its transaction is
        // visible. Keep the operation key and fingerprint until the exact
        // original body is safely retried or a job appears.
        setError("The original operation is not visible yet. Check again, or re-enter the exact original settings to retry with the same operation key.");
        return;
      }
      if (!response.ok || !data.id) {
        throw new Error(data.error || "Could not verify the earlier request. No new animation will be started.");
      }
      const currentSource = sourceRef.current;
      writePendingPhotoAnimation(userId, currentSource, data.id);
      clearPhotoAnimationOperationIntent(userId, currentSource);
      setOperationIntent(null);
      setRetryingOriginal(false);
      setJob({ id: data.id, status: data.status || "pending" });
      onJobStartedRef.current?.(data.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the earlier request. No new animation will be started.");
    } finally {
      setRecoveringOperation(false);
    }
  }

  function detectSourceAspect(event: SyntheticEvent<HTMLImageElement>) {
    if (detectedAspect.current) return;
    detectedAspect.current = true;
    const image = event.currentTarget;
    const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
    setAspectRatio(ratio >= 1.2 ? "16:9" : ratio <= 0.8 ? "9:16" : "1:1");
  }

  useEffect(() => {
    if (!job?.id || job.status === "completed" || job.status === "ready" || job.status === "failed") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${job.id}`, { credentials: "include" });
        if (!response.ok) return;
        const data = await response.json() as JobState;
        if (cancelled) return;
        setJob({ id: job.id, status: data.status });
        if (data.status === "completed" || data.status === "ready" || data.status === "failed") {
          clearPendingPhotoAnimation(userId, sourceRef.current);
          if (data.status === "completed" || data.status === "ready") onCompletedRef.current?.(job.id!);
        }
      } catch {
        // A transient poll failure is safe; the durable job remains recoverable.
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [job?.id, job?.status, sourceKey, userId]);

  async function requestQuote() {
    if (!input.prompt || input.prompt.length > 1000) return;
    setLoading("quote");
    setError(null);
    try {
      const response = await fetch("/api/photo-animations/quote", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not quote this animation.");
      setQuote(data as PhotoAnimationQuote);
      setQuotedInput(input);
      setApproved(false);
      if (!operationIntent) idempotencyKey.current = newIdempotencyKey();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not quote this animation.");
    } finally {
      setLoading(null);
    }
  }

  async function submit() {
    if (!quote || !quotedInput || !approved) return;
    setLoading("submit");
    setError(null);
    const requestBody = {
      ...quotedInput,
      prompt: quote.prompt,
      approved: true as const,
      expectedCredits: quote.totalCredits,
      planFingerprint: quote.planFingerprint,
      idempotencyKey: idempotencyKey.current,
    };
    const intent: PhotoAnimationOperationIntent = {
      idempotencyKey: idempotencyKey.current,
      requestFingerprint: await photoAnimationRequestFingerprint(requestBody),
      sourceKey: source.kind === "asset" ? `asset:${source.imageAssetId}` : `upload:${source.objectPath}`,
      createdAt: Date.now(),
    };
    if (operationIntent && !matchesPhotoAnimationOperation(operationIntent, intent.requestFingerprint)) {
      setLoading(null);
      setError("These settings do not match the unresolved original request. Restore the exact prompt and options, or check its status again.");
      return;
    }
    // This durable marker is written before POST. It contains no prompt or
    // request body, and prevents a reload from silently creating a new charge.
    writePhotoAnimationOperationIntent(userId, source, intent);
    try {
      const response = await fetch("/api/photo-animations", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      let data: { id?: string; status?: string; code?: string; error?: string };
      try {
        data = await response.json();
      } catch {
        setOperationIntent(intent);
        throw new Error("The response was interrupted. Check the original operation before trying again.");
      }
      if (!response.ok) {
        const unambiguousRejection = isUnambiguousPhotoAnimationRejection(response.status, data.code);
        if (unambiguousRejection) {
          clearPhotoAnimationOperationIntent(userId, source);
          setOperationIntent(null);
          setRetryingOriginal(false);
          idempotencyKey.current = newIdempotencyKey();
          setQuote(null);
          setQuotedInput(null);
          setApproved(false);
        } else {
          setOperationIntent(operationIntent ?? intent);
        }
        throw new Error(data.error || "Could not start this animation.");
      }
      if (!data.id) {
        setOperationIntent(intent);
        throw new Error("The response was interrupted. Check the original operation before trying again.");
      }
      setJob({ id: data.id, status: data.status });
      writePendingPhotoAnimation(userId, source, data.id);
      clearPhotoAnimationOperationIntent(userId, source);
      setOperationIntent(null);
      setRetryingOriginal(false);
      onJobStartedRef.current?.(data.id);
    } catch (cause) {
      // Keep the key: a lost response may still have created this exact intent.
      if (readPhotoAnimationOperationIntent(userId, source)) setOperationIntent(intent);
      setError(cause instanceof Error ? cause.message : "Connection interrupted. Retry safely.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[96dvh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-primary" /> Animate this photo</DialogTitle>
          <DialogDescription>Review the exact motion prompt and credit cost before anything is generated.</DialogDescription>
        </DialogHeader>

        {operationIntent && !retryingOriginal ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              <p className="font-medium">Checking an earlier request</p>
              <p className="mt-1 text-muted-foreground">
                Its response may have been lost. To prevent duplicate credit spend, a new animation is blocked until that operation is resolved.
              </p>
            </div>
            <Button
              className="min-h-11 w-full"
              variant="outline"
              disabled={recoveringOperation}
              onClick={() => void recoverOperation(operationIntent)}
            >
              {recoveringOperation && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Check original operation
            </Button>
            <Button
              className="min-h-11 w-full"
              variant="ghost"
              onClick={() => {
                idempotencyKey.current = operationIntent.idempotencyKey;
                setRetryingOriginal(true);
                setError(null);
              }}
            >
              Re-enter original settings
            </Button>
          </div>
        ) : job?.id ? (
          <div className="space-y-4">
            <img src={imageUrl} alt="Animation source" onLoad={detectSourceAspect} className="mx-auto max-h-56 w-full rounded-lg bg-black object-contain" />
            <div className="rounded-lg border p-4 text-sm">
              <p className="font-medium">{job.status === "completed" || job.status === "ready" ? "Your clip is ready" : job.status === "failed" ? "Animation failed" : "Animation is processing"}</p>
              <p className="mt-1 text-muted-foreground">This job is saved and will continue if you close this window.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button asChild className="h-11"><Link href={`/jobs/${job.id}`}>View job <ExternalLink className="ml-2 h-4 w-4" /></Link></Button>
              <Button asChild variant="outline" className="h-11"><Link href="/gallery">Open Gallery</Link></Button>
            </div>
          </div>
        ) : quote ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/25 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Safety-approved prompt</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{quote.prompt}</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <span className="text-sm">Total cost</span><strong>{quote.totalCredits} credits</strong>
            </div>
            <label className="flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm">
              <Checkbox checked={approved} onCheckedChange={(value) => setApproved(value === true)} aria-label="Approve prompt and cost" />
              <span>I approve this exact prompt and the {quote.totalCredits}-credit cost.</span>
            </label>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" className="h-11" onClick={() => { setQuote(null); setQuotedInput(null); setApproved(false); }}>Back</Button>
              <Button className="h-11" disabled={!approved || loading === "submit"} onClick={submit}>
                {loading === "submit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Create animation
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <img src={imageUrl} alt="Animation source" onLoad={detectSourceAspect} className="mx-auto max-h-56 w-full rounded-lg bg-black object-contain" />
            <div>
              <Label>Motion preset</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {PRESETS.map((preset) => <Button key={preset.label} type="button" variant="outline" className="h-11 whitespace-normal text-xs" onClick={() => setPrompt(preset.prompt)}>{preset.label}</Button>)}
              </div>
            </div>
            <div>
              <Label htmlFor="animation-prompt">Motion prompt</Label>
              <Textarea id="animation-prompt" className="mt-2 min-h-24" maxLength={1000} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              <p className="mt-1 text-right text-xs text-muted-foreground">{prompt.length}/1000</p>
            </div>
            {operationIntent && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                Only the exact original request can be retried. A different request will remain blocked.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Option label="Length" value={String(durationSeconds)} onChange={(value) => setDuration(Number(value) as 5 | 10)} values={[["5", "5 seconds"], ["10", "10 seconds"]]} />
              <Option label="Provider" value={provider} onChange={(value) => setProvider(value as "kling" | "runway")} values={[["kling", "Kling"], ["runway", "Runway"]]} />
              <Option label="Shape" value={aspectRatio} onChange={(value) => setAspectRatio(value as PhotoAnimationInput["aspectRatio"])} values={[["16:9", "Landscape"], ["9:16", "Portrait"], ["1:1", "Square"]]} />
            </div>
            <p className="text-xs text-muted-foreground">Output quality: 720p</p>
            <Button className="h-11 w-full" disabled={!prompt.trim() || prompt.length > 1000 || loading === "quote"} onClick={requestQuote}>
              {loading === "quote" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Review prompt & cost
            </Button>
          </div>
        )}
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

function Option({ label, value, onChange, values }: { label: string; value: string; onChange: (value: string) => void; values: string[][] }) {
  return <div><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger className="mt-2 h-11"><SelectValue /></SelectTrigger><SelectContent>{values.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent></Select></div>;
}