import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Smile, Upload, Wand2, Copy, Check, ArrowRight, Info } from "lucide-react";
import { useGetDashboardStats } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  canAffordCredits,
  calculateLipsyncCost,
  calculateLipsyncCostFromSourceVideo,
  LIPSYNC_DEFAULT_SECONDS,
  LIPSYNC_MAX_SECONDS,
  LIPSYNC_MIN_SECONDS,
} from "@/lib/creditPricing";
import {
  HYBRID_REMIX_KIND,
  isDurationMismatched,
  type HybridRemixHandoff,
} from "@/lib/hybridRemixHandoff";
import TopUpRequiredDialog from "@/components/TopUpRequiredDialog";

// Lip sync is billed per second (OmniHuman ~$0.16/s at 1.5x markup). Mirrors
// the server's calculateLipsyncCost() in lib/creditCost.ts exactly, so the
// price shown here never drifts from what's actually charged.
const LIP_PRESETS = [5, 10, 15, 20, 30].filter((s) => s >= LIPSYNC_MIN_SECONDS && s <= LIPSYNC_MAX_SECONDS);

// The "Guided Hybrid Lip Sync Remix" tutorial's approved example prompt: a
// purely visual story with no on-screen performer, since the face/performance
// only ever enters through the separate Lip Sync step below -- prompting a
// singer/character here would just get overwritten by (and potentially
// clash with) the Lip Sync avatar once combined. Kept comfortably under
// Runway's 1000-character prompt limit.
const HYBRID_VISUAL_PROMPT =
  "A neon-lit city at night, rain-slicked streets reflecting pink and blue signage. " +
  "Slow drone shots glide over rooftops, then drop to street level: umbrellas bobbing " +
  "through crowds, a lone figure walking past glowing storefronts. Close-ups of raindrops " +
  "on glass, steam rising from a food cart, headlights streaking past in long exposure. " +
  "Cut to a rooftop at golden hour, the skyline stretching to the horizon, birds crossing " +
  "the frame. End on a wide shot of the skyline at dusk, lights flickering on one by one. " +
  "Cinematic, moody, atmospheric -- no people in close-up, no singer, no on-camera performer; " +
  "the performance image goes in the Lip Sync step, not here.";

async function presignAndUpload(file: File): Promise<string> {
  const res = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) throw new Error("Could not get an upload URL");
  const { uploadURL, objectPath } = await res.json();
  const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return objectPath as string;
}

/**
 * Lip Sync: upload a face photo and turn it into a singing avatar synced to a
 * short clip of this video's song, via the Pixazo OmniHuman lipsync API.
 */
function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function clampStartTime(startTime: number, totalDuration: number | null, clipDuration: number): number {
  if (totalDuration === null) return Math.max(0, startTime);
  return Math.max(0, Math.min(startTime, Math.max(0, totalDuration - clipDuration)));
}

function clampDuration(seconds: number | null | undefined): number {
  return Math.min(
    Math.max(Math.round(seconds ?? LIPSYNC_DEFAULT_SECONDS), LIPSYNC_MIN_SECONDS),
    LIPSYNC_MAX_SECONDS,
  );
}

interface LipsyncResult {
  videoId: string;
  url: string;
  // Present when the source video has well-defined generation inputs (see
  // sourcePriceBasis below) -- everything the "Insert into video" hybrid
  // handoff needs except the resolved song audio, which is fetched on demand
  // (see insertIntoVideo) rather than on every Lip Sync request.
  hybridRemix?: {
    originalVideoId: string;
    originalObjectPath: string;
    originalThumbnailPath: string | null;
    originalDurationSec: number | null;
    lipsyncObjectPath: string;
    lipsyncThumbnailPath: string | null;
    lipsyncStartTime: number;
    lipsyncSeconds: number;
    hasSourceAudio: boolean;
  };
}

export default function LipSyncPanel({
  videoId,
  audioDurationSeconds,
  initialStartTime = 0,
  initialSeconds = LIPSYNC_DEFAULT_SECONDS,
  sourcePriceBasis = null,
}: {
  videoId: string;
  audioDurationSeconds?: number | null;
  initialStartTime?: number | null;
  initialSeconds?: number | null;
  // The source video's own generation inputs, when it was AI-generated (or a
  // remix of one) -- lets this panel price from that video's real provider
  // cost instead of the lipsync clip's own duration, AND gates the "Make a
  // hybrid video" tutorial + insert-into-video handoff below (both need a
  // well-defined source video/job to combine against). Pass null/omit for a
  // source video with no such well-defined cost (e.g. a Studio editor_render
  // export), which falls back to the duration-based rate and hides the
  // hybrid tutorial.
  sourcePriceBasis?: {
    requestedDuration: string | null;
    resolution: string | null;
    provider: string | null;
  } | null;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [seconds, setSeconds] = useState(() => clampDuration(initialSeconds));
  const totalDuration =
    typeof audioDurationSeconds === "number" && Number.isFinite(audioDurationSeconds) && audioDurationSeconds > 0
      ? audioDurationSeconds
      : null;
  const [startTime, setStartTime] = useState(() => clampStartTime(initialStartTime ?? 0, totalDuration, 15));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LipsyncResult | null>(null);
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [insertBusy, setInsertBusy] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  // When we know the source video's own generation inputs, price is fixed
  // from that video's real cost (see calculateLipsyncCostFromSourceVideo) --
  // it does NOT change as the user adjusts the clip length below. Otherwise
  // fall back to the duration-based rate, exactly like the standalone/admin
  // Lip Sync Generator.
  const cost = sourcePriceBasis
    ? calculateLipsyncCostFromSourceVideo(
        sourcePriceBasis.requestedDuration,
        sourcePriceBasis.resolution,
        totalDuration,
        sourcePriceBasis.provider,
      )
    : calculateLipsyncCost(seconds);
  const { data: statsData } = useGetDashboardStats({});
  const balance = statsData?.creditsRemaining ?? null;
  const [topUpOpen, setTopUpOpen] = useState(false);
  const maxStartTime = totalDuration === null ? 0 : Math.max(0, Math.floor(totalDuration - seconds));
  const canChooseRange = totalDuration !== null && totalDuration > seconds;
  const rangeEndTime = startTime + seconds;
  const rangeLabel = `${formatTime(startTime)}\u2013${formatTime(rangeEndTime)}`;

  // Same gate the server uses for source-cost pricing: a well-defined source
  // job (jobType "ai" or "remix") is required both to price Lip Sync from
  // the source video's real cost AND to offer the guided hybrid tutorial --
  // there's no coherent "original video" to combine back into otherwise.
  const hybridEligible = sourcePriceBasis !== null;

  // Keep an inherited start point and any user-selected duration inside the
  // source song. This prevents an out-of-range request before upload/charge.
  useEffect(() => {
    setStartTime((current) => clampStartTime(current, totalDuration, seconds));
  }, [totalDuration, seconds]);

  async function run(file: File) {
    if (!enabled) return;
    // Proactive credit check — show the top-up modal instead of letting the
    // user hit a backend failure after submitting.
    if (!canAffordCredits(cost, balance)) {
      setTopUpOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setInsertError(null);
    setFacePreview(URL.createObjectURL(file));
    try {
      const imageObjectPath = await presignAndUpload(file);
      const r = await fetch(`/api/videos/${videoId}/lipsync`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageObjectPath,
          lipsyncSeconds: seconds,
          lipsyncStartTime: startTime,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Lip sync failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lip sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(HYBRID_VISUAL_PROMPT);
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select the prompt text above and copy it manually.",
        variant: "destructive",
      });
    }
  }

  // Step 3 of the guided flow: hand the successful Lip Sync result off to
  // Remix Lab as a prefilled replacement timeline (original video before the
  // range, the Lip Sync clip in the range, original video after it) with the
  // untouched original song as the single continuous soundtrack. Resolves
  // the song's Remix-Lab-usable object path on demand (see routes/teasers.ts
  // GET /videos/:id/song-audio) rather than eagerly on every Lip Sync
  // request, then validates it before ever navigating away.
  async function insertIntoVideo() {
    const hr = result?.hybridRemix;
    if (!hr) return;
    if (!hr.hasSourceAudio) {
      setInsertError(
        "This video has no source song on file, so there's nothing to use as the combined soundtrack. Open Remix Lab and add music manually instead.",
      );
      return;
    }
    setInsertBusy(true);
    setInsertError(null);
    try {
      const r = await fetch(`/api/videos/${hr.originalVideoId}/song-audio`, { credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not prepare the song audio.");

      const originalDurationSec = hr.originalDurationSec ?? 0;
      if (!hr.originalDurationSec) {
        throw new Error("This video's own duration is unknown, so a safe replacement timeline can't be built.");
      }
      if (isDurationMismatched(originalDurationSec, data.durationSec ?? null)) {
        setInsertError(
          "The original song's length doesn't quite match this video's length, so we can't safely combine them automatically. You can still open Remix Lab and do it by hand.",
        );
        return;
      }

      const handoff: HybridRemixHandoff = {
        kind: HYBRID_REMIX_KIND,
        originalVideoId: hr.originalVideoId,
        originalObjectPath: hr.originalObjectPath,
        originalThumbnailPath: hr.originalThumbnailPath,
        originalDurationSec,
        lipsyncVideoId: result!.videoId,
        lipsyncObjectPath: hr.lipsyncObjectPath,
        lipsyncThumbnailPath: hr.lipsyncThumbnailPath,
        lipsyncStartTime: hr.lipsyncStartTime,
        lipsyncDurationSec: hr.lipsyncSeconds,
        songObjectPath: data.objectPath,
        songDurationSec: data.durationSec ?? null,
      };
      sessionStorage.setItem("editor:init", JSON.stringify(handoff));
      setLocation("/editor");
    } catch (err) {
      setInsertError(err instanceof Error ? err.message : "Could not prepare the hybrid video.");
    } finally {
      setInsertBusy(false);
    }
  }

  const hr = result?.hybridRemix;
  // Start-of-song / end-of-song aren't errors -- just guidance about which
  // side segment gets omitted, so the tutorial doesn't leave the user
  // wondering where their "before" or "after" clip went.
  const insertGuidance =
    hr && hr.originalDurationSec != null
      ? hr.lipsyncStartTime <= 0.15
        ? "The performance starts at 0:00, so the hybrid video will open directly with it — no clip before it."
        : hr.lipsyncStartTime + hr.lipsyncSeconds >= hr.originalDurationSec - 0.15
          ? "The performance runs to the end of the song, so the hybrid video will close on it — no clip after it."
          : null
      : null;

  return (
    <>
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Smile className="h-4 w-4 text-primary" /> Lip Sync
            <span className="rounded-full border border-primary/25 bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">Optional</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <label htmlFor={`enable-lipsync-${videoId}`} className="text-xs font-medium text-muted-foreground">
              {enabled ? "On" : "Off"}
            </label>
            <Switch
              id={`enable-lipsync-${videoId}`}
              checked={enabled}
              disabled={busy}
              onCheckedChange={setEnabled}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {enabled
            ? "Upload a face photo and we'll animate it to sing a selected clip of this video's song. Takes a few minutes and saves as a new video in your library."
            : "Optional add-on. Turn it on when you want to animate a face photo to sing part of this video's song."}
        </p>

        {hybridEligible && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Wand2 className="h-4 w-4" /> Make a hybrid video
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Get a fully visual Full-track video, then use Lip Sync below to generate one short
              performance moment from the same song. We'll insert it into your video in Remix
              Lab automatically — the performance image only ever goes in the Lip Sync step, never
              in the visual prompt.
            </p>
            <ol className="text-xs text-muted-foreground leading-relaxed list-decimal list-inside space-y-1">
              <li>Create the visual video with a purely visual prompt (example below).</li>
              <li>Choose a short song range below and generate a Lip Sync performance for it.</li>
              <li>Combine them — we'll open Remix Lab with everything already in place.</li>
            </ol>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">Example visual-only prompt</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={copyPrompt}
                >
                  {promptCopied ? (
                    <><Check className="mr-1 h-3 w-3" /> Copied</>
                  ) : (
                    <><Copy className="mr-1 h-3 w-3" /> Copy</>
                  )}
                </Button>
              </div>
              <p className="rounded-md border border-border bg-background/60 p-2 text-[11px] text-muted-foreground leading-relaxed">
                {HYBRID_VISUAL_PROMPT}
              </p>
            </div>
          </div>
        )}

        {enabled && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={`lipsync-duration-${videoId}`} className="text-sm font-medium">Clip length</label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={`lipsync-duration-${videoId}`}
                    type="number"
                    min={LIPSYNC_MIN_SECONDS}
                    max={LIPSYNC_MAX_SECONDS}
                    step={1}
                    value={seconds}
                    disabled={busy}
                    onChange={(event) => setSeconds(clampDuration(Number(event.target.value)))}
                    className="h-8 w-16 text-center text-xs tabular-nums"
                    aria-label="Lip Sync clip length in seconds"
                  />
                  <span className="text-xs text-muted-foreground">sec</span>
                </div>
              </div>
              <input
                type="range"
                min={LIPSYNC_MIN_SECONDS}
                max={LIPSYNC_MAX_SECONDS}
                step={1}
                value={seconds}
                disabled={busy}
                onChange={(event) => setSeconds(Number(event.target.value))}
                className="w-full accent-primary disabled:opacity-50"
              />
              <div className="flex flex-wrap gap-1.5">
                {LIP_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={busy}
                    onClick={() => setSeconds(preset)}
                    className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${seconds === preset ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:border-primary/50"}`}
                  >
                    {preset}s
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Choose any whole-second length from {LIPSYNC_MIN_SECONDS}\u2013{LIPSYNC_MAX_SECONDS} seconds.{" "}
                {sourcePriceBasis ? (
                  <><strong>{cost} credits</strong> — priced from this video's own generation cost, not clip length.</>
                ) : (
                  <><strong>{cost} credits</strong> — billed per second.</>
                )}
              </p>
            </div>
            {canChooseRange && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={`lipsync-range-${videoId}`} className="text-sm font-medium">Song range</label>
                  <span className="text-xs font-medium tabular-nums text-primary">{rangeLabel}</span>
                </div>
                <input
                  id={`lipsync-range-${videoId}`}
                  type="range"
                  min={0}
                  max={maxStartTime}
                  step={1}
                  value={Math.min(startTime, maxStartTime)}
                  disabled={busy}
                  onChange={(event) => setStartTime(Number(event.target.value))}
                  className="w-full accent-primary disabled:opacity-50"
                />
                <p className="text-[11px] text-muted-foreground">
                  Choose the section of your song the avatar should perform. Your video remains the full track.
                </p>
              </div>
            )}

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) run(f);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-3">
              <Button variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
                {busy ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Syncing… (a few min)</>
                ) : (
                  <><Upload className="mr-2 h-4 w-4" /> Upload a face · {cost} cr</>
                )}
              </Button>
              {facePreview && !result && (
                <img src={facePreview} alt="Uploaded face photo preview" className="h-16 w-16 rounded-lg border border-border object-cover" />
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {result && (
              <div className="space-y-2">
                <video src={result.url} controls playsInline className="w-full max-w-md rounded-lg border border-border bg-black" />
                <p className="text-xs text-muted-foreground">Saved to your library as a new video.</p>

                {hybridEligible && hr && (
                  <div className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
                    <p className="text-xs font-medium">Step 3: combine into your video</p>
                    {insertGuidance && (
                      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {insertGuidance}
                      </p>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      disabled={insertBusy}
                      onClick={insertIntoVideo}
                    >
                      {insertBusy ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing…</>
                      ) : (
                        <>Insert into video <ArrowRight className="ml-2 h-4 w-4" /></>
                      )}
                    </Button>
                    {insertError && <p className="text-xs text-destructive">{insertError}</p>}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>

    <TopUpRequiredDialog
      open={topUpOpen}
      onOpenChange={setTopUpOpen}
      creditsRequired={cost}
      creditsRemaining={balance ?? 0}
      title="More credits needed for lipsync"
    />
    </>
  );
}
