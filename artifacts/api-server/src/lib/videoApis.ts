export interface ClipRequest {
  prompt: string;
  durationSeconds: number;
  aspectRatio?: string;
  /** HTTPS URL of the reference image (GCS signed URL). When absent, text_to_video is used. */
  imageUrl?: string;
  /** Preferred engine chosen by the user (e.g. "runway", "kling"); pinned first in the chain. */
  provider?: string;
  /** Requested output resolution ("720p" | "1080p" | "4k"). Selects the Kling model tier + gateway hint. */
  resolution?: string | null;
  /** When true, do not continue to another provider after this provider fails. */
  providerOnly?: boolean;
  /**
   * Called as soon as the provider accepts the render request, BEFORE polling
   * begins. Lets the caller persist the request id / poll URL so a clip that
   * finishes after the server stops polling (crash, freeze, deploy) can be
   * recovered later instead of being paid for twice.
   */
  onSubmit?: (info: { provider: string; requestId: string; pollUrl: string }) => void | Promise<void>;
  /**
   * Called when submission may have reached the provider but no durable request
   * id was returned. The caller must persist this before exposing a retry.
   */
  onUncertainSubmission?: (info: {
    provider: string;
    status?: number;
    activityId?: string;
    reason: string;
  }) => void | Promise<void>;
}

export interface ClipResult {
  videoUrl: string;
  provider: string;
}

type Provider = "runway" | "luma" | "kling" | "pixazo";
const PIXAZO_SUBMIT_TIMEOUT_MS = 90_000;
// Runway's current gateway model id. The versioned Runway routes below are
// documented against this id; do not take it from a stale environment override.
const PIXAZO_RUNWAY_MODEL = "runway-gen-4-5";

function providerAvailable(p: Provider): boolean {
  if (p === "luma") return !!process.env.LUMA_API_KEY;
  // "kling" and "pixazo" run through the Pixazo gateway (single key).
  if (p === "kling") return !!process.env.PIXAZO_API_KEY;
  if (p === "pixazo") return !!process.env.PIXAZO_API_KEY;
  // Runway is available through the Pixazo gateway whenever its shared key is
  // present. Its supported model id is pinned above rather than being supplied
  // by an easily-stale environment value.
  if (p === "runway") return !!process.env.PIXAZO_API_KEY;
  return false;
}

// Kling model slug on Pixazo. 720p/1080p use the standard model (~$0.07/s,
// override with PIXAZO_KLING_MODEL). 4K is a distinct higher-tier model on the
// gateway, so set PIXAZO_KLING_4K_MODEL to that slug; if it's unset we fall back
// to the standard model (still renders, just not native 4K).
function klingModel(resolution?: string | null): string {
  const r = (resolution ?? "").toLowerCase();
  if (r === "4k" || r === "2160p") {
    const m = process.env.PIXAZO_KLING_4K_MODEL?.trim();
    if (m) return m;
  }
  return process.env.PIXAZO_KLING_MODEL?.trim() || "kling-video-v3-turbo-pro-text-to-video";
}

// Ordered provider chain with automatic fallback. Default order: Kling via
// Pixazo first, then Runway via Pixazo (if PIXAZO_RUNWAY_MODEL is set), then
// Luma. Override the whole order with VIDEO_API_CHAIN env var.
// VIDEO_API pins the primary provider.
export function getProviderChain(): Provider[] {
  const chainEnv = process.env.VIDEO_API_CHAIN
    ?.toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as Provider[] | undefined;
  const primary = process.env.VIDEO_API?.toLowerCase() as Provider | undefined;
  let order: Provider[];
  if (chainEnv && chainEnv.length) {
    order = chainEnv;
  } else {
    order = ["kling", "runway", "pixazo", "luma"];
    if (primary && order.includes(primary)) order = [primary, ...order.filter((p) => p !== primary)];
  }
  return order.filter(providerAvailable);
}

function getProvider(): Provider | null {
  return getProviderChain()[0] ?? null;
}

export function getActiveProvider(hint?: string | null): string {
  const h = hint?.toLowerCase() as Provider | undefined;
  if (h === "runway" && providerAvailable("runway")) return "runway";
  if (h === "kling" && process.env.PIXAZO_API_KEY) return "kling";
  if (h === "luma" && process.env.LUMA_API_KEY) return "luma";
  if (h === "pixazo" && process.env.PIXAZO_API_KEY) return "pixazo";
  return getProvider() ?? "simulation";
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";

// --- Direct Runway, audio-driven character render (admin-only Runway Lip
// Sync Generator) -------------------------------------------------------------
// REAL, VERIFIED Runway endpoint (checked against Runway's public API docs,
// docs.dev.runwayml.com, Aug 2026): POST /v1/avatar_videos with model
// "gwm1_avatars" generates a video of a talking Avatar driven by a raw audio
// track (speech: {type: "audio", audio: <url>}). This is NOT the same as
// Act-Two/character_performance, which needs a driving PERFORMANCE VIDEO of
// an actor, not audio -- that endpoint can't do "character sings along to a
// song" at all.
//
// avatar_videos doesn't take an inline reference image per request -- Runway's
// Avatar system is built on persistent Avatar objects (POST /v1/avatars), so
// this function creates a throwaway Avatar from the character's reference
// image, generates against it, then best-effort deletes it afterward.
//
// CAVEAT (documented honestly, not swept under the rug): Runway's own
// generated API reference only shows avatar_videos' `avatar` field accepting
// {type: "runway-preset", presetId: <one of 9 fixed personas>} -- it does NOT
// show a {type: "custom", avatarId} branch for THIS endpoint. That shape is
// confirmed for the sibling realtime_sessions endpoint (same model,
// identical doc-rendering gap there too -- Runway's doc generator collapses
// oneOf unions to their first branch), and is a reasonable bet for
// avatar_videos, but is unconfirmed. If Runway rejects the custom-avatar
// shape, this throws a clear error and the job fails cleanly -- it never
// falls back to Pixazo, Kling, or Luma.
export interface RunwayLipsyncRequest {
  imageUrl: string;
  audioUrl: string;
  // Informational only: avatar_videos has no duration field in its schema --
  // Runway derives the output length from the audio itself. The trimmed
  // segment uploaded as audioUrl is what actually bounds the render length.
  durationSeconds: number;
}

export function runwayCharacterLipsyncAvailable(): boolean {
  return !!process.env.RUNWAY_API_KEY && !!process.env.RUNWAY_LIPSYNC_MODEL?.trim();
}

async function createRunwayAvatar(imageUrl: string, label: string): Promise<string> {
  const apiKey = process.env.RUNWAY_API_KEY!;
  const res = await fetch(`${RUNWAY_BASE}/avatars`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Runway-Version": RUNWAY_VERSION,
    },
    body: JSON.stringify({
      name: label.slice(0, 50),
      referenceImage: imageUrl,
      // personality/voice are REQUIRED by the Avatars API (it's built for
      // Runway's conversational/live-session product) but are irrelevant
      // here -- this Avatar is only ever used once, for a single audio-driven
      // video, never a live conversation. Minimal placeholder values.
      personality: "A character used for a single audio-driven test video. Not used for conversation.",
      voice: { type: "runway-live-preset", presetId: "clara" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(`Runway avatar creation ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const avatar = (await res.json()) as { id: string };
  if (!avatar.id) throw new Error("Runway avatar creation: no id returned");
  return avatar.id;
}

// Best-effort cleanup of the throwaway Avatar -- never throws, since a
// leaked Avatar is harmless clutter, not a failure worth surfacing.
async function deleteRunwayAvatar(avatarId: string): Promise<void> {
  try {
    await fetch(`${RUNWAY_BASE}/avatars/${avatarId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${process.env.RUNWAY_API_KEY!}`, "X-Runway-Version": RUNWAY_VERSION },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // ignore -- best effort only
  }
}

export async function generateRunwayCharacterLipsync(req: RunwayLipsyncRequest): Promise<string> {
  if (!runwayCharacterLipsyncAvailable()) {
    throw new Error(
      "Runway audio-driven character lip sync isn't enabled -- set RUNWAY_LIPSYNC_MODEL=gwm1_avatars (and RUNWAY_API_KEY, if not already set) to turn it on. This never falls back to another provider.",
    );
  }
  const apiKey = process.env.RUNWAY_API_KEY!;
  const model = process.env.RUNWAY_LIPSYNC_MODEL!.trim();

  const avatarId = await createRunwayAvatar(req.imageUrl, `lipsync-${Date.now()}`);

  let taskId: string;
  try {
    const genRes = await fetch(`${RUNWAY_BASE}/avatar_videos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Runway-Version": RUNWAY_VERSION,
      },
      body: JSON.stringify({
        model,
        avatar: { type: "custom", avatarId },
        speech: { type: "audio", audio: req.audioUrl },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!genRes.ok)
      throw new Error(`Runway avatar video ${genRes.status}: ${(await genRes.text()).slice(0, 300)}`);
    const task = (await genRes.json()) as { id: string };
    if (!task.id) throw new Error("Runway avatar video: no task id returned");
    taskId = task.id;
  } catch (err) {
    await deleteRunwayAvatar(avatarId);
    throw err;
  }

  try {
    // Audio-driven character generation can run long -- allow up to ~15 min.
    for (let i = 0; i < 180; i++) {
      await delay(5000);
      const pollRes = await fetch(`${RUNWAY_BASE}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, "X-Runway-Version": RUNWAY_VERSION },
        signal: AbortSignal.timeout(15_000),
      });
      if (!pollRes.ok) continue;
      const task = (await pollRes.json()) as {
        status: string;
        output?: string[];
        failure?: string | { message?: string; [key: string]: unknown };
      };
      if (task.status === "SUCCEEDED" && task.output?.[0]) return task.output[0];
      if (task.status === "FAILED") {
        const fail = task.failure;
        const failMsg =
          typeof fail === "string"
            ? fail
            : fail?.message
              ? fail.message
              : fail
                ? JSON.stringify(fail).slice(0, 300)
                : "no details provided";
        throw new Error(`Runway avatar video task failed: ${failMsg}`);
      }
    }
    throw new Error("Runway avatar video task timed out after 15 minutes");
  } finally {
    void deleteRunwayAvatar(avatarId);
  }
}

async function generateWithLuma(req: ClipRequest): Promise<string> {
  const apiKey = process.env.LUMA_API_KEY!;

  const genRes = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: req.prompt.slice(0, 2000),
      aspect_ratio: req.aspectRatio ?? "16:9",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!genRes.ok)
    throw new Error(`Luma ${genRes.status}: ${(await genRes.text()).slice(0, 200)}`);
  const { id } = (await genRes.json()) as { id: string };

  for (let i = 0; i < 120; i++) {
    await delay(5000);
    const pollRes = await fetch(
      `https://api.lumalabs.ai/dream-machine/v1/generations/${id}`,
      { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!pollRes.ok) continue;
    const status = (await pollRes.json()) as {
      state: string;
      assets?: { video?: string };
      failure_reason?: string;
    };
    if (status.state === "completed" && status.assets?.video) return status.assets.video;
    if (status.state === "failed")
      throw new Error(`Luma generation failed: ${status.failure_reason}`);
  }
  throw new Error("Luma generation timed out after 10 minutes");
}

// Marker included in every Pixazo/Kling error message so retryOrFail knows
// to permanently fail the job without re-queuing. AI provider charges happen at
// submission time — retrying after a provider failure just doubles the bill.
export const PROVIDER_API_FAILURE = "[PROVIDER_FAILURE]";
export const PROVIDER_POLL_TIMEOUT = "[PROVIDER_POLL_TIMEOUT]";
// Marker appended when the failure was the provider running out of tokens /
// credits (Pixazo 402, quota exceeded, insufficient balance, …).
export const PROVIDER_OUT_OF_CREDITS = "[PROVIDER_OUT_OF_CREDITS]";

// Pixazo (pixazo.ai) — a unified gateway that fronts Kling, Runway, Veo, etc.
// behind one API key (Ocp-Apim-Subscription-Key). Submit to a model endpoint,
// then poll the universal status endpoint for the result. Pick your exact model
// slug from the Pixazo dashboard and set it as PIXAZO_MODEL.
//
// t2vOverride — text-to-video model slug (e.g. PIXAZO_RUNWAY_MODEL for Runway).
// i2vOverride — image-to-video model slug used when req.imageUrl is present
//               (e.g. PIXAZO_RUNWAY_I2V_MODEL). Falls back to Kling i2v defaults
//               when absent so existing Kling callers are unaffected.
async function generateWithPixazo(
  req: ClipRequest,
  t2vOverride?: string,
  i2vOverride?: string,
  provider: "kling" | "runway" = "kling",
): Promise<string> {
  const key = process.env.PIXAZO_API_KEY!;
  const duration = req.durationSeconds <= 5 ? "5" : "10";
  const r = (req.resolution ?? "").toLowerCase();
  const is4k = r === "4k" || r === "2160p";
  const hasImage = !!req.imageUrl;

  // Pick the model slug. When an explicit i2v override is provided and the
  // request carries a reference image, use it. Otherwise fall back to the Kling
  // i2v slugs (4K or standard). Text-to-video always uses t2vOverride first.
  let model: string;
  if (hasImage) {
    if (i2vOverride) {
      model = i2vOverride;
    } else {
      model = is4k
        ? (process.env.PIXAZO_KLING_4K_I2V_MODEL?.trim() || "kling-video-o3-4k-image-to-video")
        : (process.env.PIXAZO_KLING_I2V_MODEL?.trim() || "kling-video-v3-turbo-pro-image-to-video");
    }
  } else {
    model = t2vOverride || process.env.PIXAZO_MODEL?.trim() || "kling-video-v3-turbo-pro-text-to-video";
  }

  const body: Record<string, unknown> = { prompt: req.prompt.slice(0, 2500) };
  let endpoint = `https://gateway.pixazo.ai/${model}/v1/${model}-request`;
  if (provider === "runway") {
    // Runway Gen-4.5 uses Pixazo's documented versioned submission routes.
    endpoint =
      `https://gateway.pixazo.ai/${model}/v1/gen-4.5/` +
      `${hasImage ? "image-to-video" : "text-to-video"}`;
    if (hasImage) body.image_url = req.imageUrl;
  } else {
    body.duration = duration;
    if (hasImage) {
      // Image-to-video: feed the reference image (aspect ratio comes from the image).
      body.image_url = req.imageUrl;
    } else {
      // Text-to-video: pass aspect ratio + resolution hint (4K also via model slug).
      body.aspect_ratio = req.aspectRatio ?? "16:9";
      if (r === "1080p") body.resolution = "1080p";
      else if (is4k) body.resolution = "4k";
      else if (r === "720p") body.resolution = "720p";
    }
  }

  const uncertainProvider = req.provider ?? "pixazo";
  let submit: Response;
  try {
    submit = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Submission can slow down during provider traffic spikes. Give the
      // request enough time to return its durable request id; aborting too early
      // leaves an ambiguous paid request that cannot be safely recovered.
      signal: AbortSignal.timeout(PIXAZO_SUBMIT_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await req.onUncertainSubmission?.({
      provider: uncertainProvider,
      reason: `Submission transport error: ${reason}`.slice(0, 240),
    });
    throw new Error(`${PROVIDER_API_FAILURE} The AI service did not confirm the scene request.`);
  }
  let submitText: string;
  try {
    submitText = await submit.text();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await req.onUncertainSubmission?.({
      provider: uncertainProvider,
      status: submit.status,
      reason: `Could not read submission response: ${reason}`.slice(0, 240),
    });
    throw new Error(`${PROVIDER_API_FAILURE} The AI service response could not be verified.`);
  }
  if (!submit.ok) {
    const text = submitText.slice(0, 500);
    if (submit.status >= 500) {
      let activityId: string | undefined;
      try {
        const parsed = JSON.parse(text) as { activityId?: unknown };
        if (typeof parsed.activityId === "string") activityId = parsed.activityId.slice(0, 120);
      } catch {
        // Non-JSON provider errors still remain uncertain by status.
      }
      await req.onUncertainSubmission?.({
        provider: uncertainProvider,
        status: submit.status,
        activityId,
        reason: `AI service returned HTTP ${submit.status}`,
      });
      const reference = activityId ? ` Reference ID: ${activityId}.` : "";
      throw new Error(
        `${PROVIDER_API_FAILURE} Service temporarily unavailable. ` +
          `No automatic retry was attempted to prevent duplicate charges. Please try again later.${reference}`,
      );
    }
    throw new Error(`${PROVIDER_API_FAILURE} AI service ${submit.status}: ${text.slice(0, 200)}`);
  }
  let parsedSubmitData: unknown;
  try {
    parsedSubmitData = JSON.parse(submitText);
  } catch {
    await req.onUncertainSubmission?.({
      provider: uncertainProvider,
      status: submit.status,
      reason: "AI service returned an unreadable success response",
    });
    throw new Error(`${PROVIDER_API_FAILURE} The AI service response could not be verified.`);
  }
  if (
    !parsedSubmitData ||
    typeof parsedSubmitData !== "object" ||
    Array.isArray(parsedSubmitData)
  ) {
    await req.onUncertainSubmission?.({
      provider: uncertainProvider,
      status: submit.status,
      reason: "AI service returned an invalid success response",
    });
    throw new Error(`${PROVIDER_API_FAILURE} The AI service response could not be verified.`);
  }
  const submitData = parsedSubmitData as {
    request_id?: unknown;
    polling_url?: unknown;
  };
  const requestId =
    typeof submitData.request_id === "string"
      ? submitData.request_id.trim()
      : "";
  if (!requestId) {
    await req.onUncertainSubmission?.({
      provider: uncertainProvider,
      reason: "AI service returned success without a request id",
    });
    throw new Error(`${PROVIDER_API_FAILURE} The AI service did not return a scene request id.`);
  }
  const pollUrl =
    typeof submitData.polling_url === "string" &&
    submitData.polling_url.trim().length > 0
      ? submitData.polling_url
      : `https://gateway.pixazo.ai/v2/requests/status/${requestId}`;

  // Persist the request id/poll URL before polling starts, so a clip that
  // completes after we stop polling is recoverable (never block the render on
  // a persistence hiccup, though).
  try {
    await req.onSubmit?.({ provider: uncertainProvider, requestId, pollUrl });
  } catch {
    await req.onUncertainSubmission?.({
      provider: uncertainProvider,
      activityId: requestId.slice(0, 120),
      reason: "Accepted scene request could not be saved for recovery",
    });
    throw new Error(
      `${PROVIDER_API_FAILURE} The AI service accepted the scene request, but its recovery state could not be saved.`,
    );
  }

  for (let i = 0; i < 120; i++) {
    await delay(5000);
    const pollRes = await fetch(pollUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pollRes.ok) continue;
    const d = (await pollRes.json()) as {
      status?: string;
      error?: string | null;
      output?: { media_url?: string[] };
    };
    if (d.status === "COMPLETED" && d.output?.media_url?.[0]) return d.output.media_url[0];
    if (d.status === "FAILED" || d.status === "ERROR") throw new Error(`${PROVIDER_API_FAILURE} Pixazo ${d.status}: ${d.error ?? "unknown error"}`);
  }
  throw new Error(`${PROVIDER_POLL_TIMEOUT} AI scene polling timed out after 10 minutes`);
}

function isCreditError(err: unknown): boolean {
  const m = String(err instanceof Error ? err.message : err).toLowerCase();
  return ["402", "credit", "quota", "insufficient", "exceeded", "payment", "balance"].some((s) => m.includes(s));
}

async function callProvider(provider: Provider, req: ClipRequest): Promise<string> {
  switch (provider) {
    case "runway":
      // Pixazo documents Gen-4.5 at a versioned, model-specific endpoint.
      return generateWithPixazo(
        req,
        PIXAZO_RUNWAY_MODEL,
        PIXAZO_RUNWAY_MODEL,
        "runway",
      );
    case "luma":
      return generateWithLuma(req);
    case "kling":
      // Kling runs through the Pixazo gateway; the model tier tracks resolution.
      return generateWithPixazo(req, klingModel(req.resolution));
    case "pixazo":
      return generateWithPixazo(req);
  }
  throw new Error(`Unknown video provider: ${provider}`);
}

export function resolveClipProviderChain(
  req: Pick<ClipRequest, "provider" | "providerOnly">,
): Provider[] {
  const pinned = req.provider?.toLowerCase() as Provider | undefined;
  if (req.providerOnly) {
    return pinned && providerAvailable(pinned) ? [pinned] : [];
  }

  let chain = getProviderChain();
  // Honor a user-chosen engine: pin it first, keeping the rest as fallback.
  if (pinned && providerAvailable(pinned)) {
    chain = [pinned, ...chain.filter((p) => p !== pinned)];
  }
  return chain;
}

// Try providers in order, automatically falling back to the next on failure
// when the caller has not pinned an engine. Kling and Runway remain Pixazo-backed;
// providerOnly is used for paid jobs to prevent duplicate cross-engine submits.
export async function generateClip(req: ClipRequest): Promise<ClipResult | null> {
  const chain = resolveClipProviderChain(req);
  if (chain.length === 0) {
    if (req.providerOnly) {
      throw new Error(
        `${PROVIDER_API_FAILURE} The selected AI video engine is unavailable. Choose another engine and submit again.`,
      );
    }
    return null;
  }

  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i]!;
    try {
      const videoUrl = await callProvider(provider, req);
      return { videoUrl, provider };
    } catch (err) {
      lastErr = err;
    }
  }
  // All providers in the chain have been tried and failed. Mark the error as
  // non-retryable so retryOrFail doesn't re-queue the job (which would call
  // Kling again). Kling-specific errors already carry the marker; for Runway
  // or other final-leg failures, we add it here so the permanent-fail path is
  // always taken regardless of which provider was last.
  const finalErr = lastErr instanceof Error ? lastErr : new Error("All video providers failed");
  // Tag token/credit exhaustion (e.g. Pixazo 402 / "insufficient balance") so
  // the job processor can stop generating and salvage the clips already made
  // instead of failing the whole job.
  const creditTag =
    isCreditError(lastErr) && !finalErr.message.includes(PROVIDER_OUT_OF_CREDITS)
      ? ` ${PROVIDER_OUT_OF_CREDITS}`
      : "";
  if (
    !finalErr.message.includes(PROVIDER_API_FAILURE) &&
    !finalErr.message.includes(PROVIDER_POLL_TIMEOUT)
  ) {
    throw new Error(`${PROVIDER_API_FAILURE}${creditTag} ${finalErr.message}`);
  }
  if (creditTag) throw new Error(`${finalErr.message}${creditTag}`);
  throw finalErr;
}

// Check a previously-submitted Pixazo request by its poll URL. Returns the
// finished media URL when COMPLETED, null when FAILED/expired/unreachable, and
// "pending" while the render is still in flight. Used to recover clips that
// finished after the server stopped polling (no new provider spend).
export async function checkPixazoRequest(pollUrl: string): Promise<{ state: "completed"; mediaUrl: string } | { state: "pending" } | { state: "gone" }> {
  const key = process.env.PIXAZO_API_KEY;
  if (!key) return { state: "gone" };
  try {
    const res = await fetch(pollUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 410) return { state: "gone" };
    if (!res.ok) return { state: "pending" };
    const d = (await res.json()) as { status?: string; output?: { media_url?: string[] } };
    if (d.status === "COMPLETED" && d.output?.media_url?.[0]) return { state: "completed", mediaUrl: d.output.media_url[0] };
    if (d.status === "FAILED" || d.status === "ERROR") return { state: "gone" };
    return { state: "pending" };
  } catch {
    return { state: "pending" };
  }
}

export async function downloadClip(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Failed to download clip from ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
