export interface ClipRequest {
  prompt: string;
  durationSeconds: number;
  aspectRatio?: string;
  /** HTTPS URL of the reference image (GCS signed URL). When absent, text_to_video is used. */
  imageUrl?: string;
  /** Preferred engine chosen by the user (e.g. "runway", "kling"); pinned first in the chain. */
  provider?: string;
  /**
   * TEMPORARY, admin-only: call the real Runway API directly instead of routing
   * "runway" through the Pixazo gateway. Set by routes/jobs.ts when the
   * requesting user is an admin (ADMIN_EMAIL) and picks the Runway engine, so
   * admins can preview genuine Runway output while everyone else keeps
   * rendering through Pixazo. Requires RUNWAY_API_KEY; silently falls back to
   * the Pixazo route if that key isn't set. Remove once no longer needed.
   */
  preferDirectRunway?: boolean;
  /** Requested output resolution ("720p" | "1080p" | "4k"). Selects the Kling model tier + gateway hint. */
  resolution?: string | null;
  /**
   * Called as soon as the provider accepts the render request, BEFORE polling
   * begins. Lets the caller persist the request id / poll URL so a clip that
   * finishes after the server stops polling (crash, freeze, deploy) can be
   * recovered later instead of being paid for twice.
   */
  onSubmit?: (info: { provider: string; requestId: string; pollUrl: string }) => void | Promise<void>;
}

export interface ClipResult {
  videoUrl: string;
  provider: string;
}

type Provider = "runway" | "luma" | "kling" | "pixazo";

function providerAvailable(p: Provider): boolean {
  if (p === "luma") return !!process.env.LUMA_API_KEY;
  // "kling" and "pixazo" run through the Pixazo gateway (single key).
  if (p === "kling") return !!process.env.PIXAZO_API_KEY;
  if (p === "pixazo") return !!process.env.PIXAZO_API_KEY;
  // "runway" now runs through the Pixazo gateway too (no direct Runway API).
  // Requires the Pixazo key AND a Runway model slug (set PIXAZO_RUNWAY_MODEL to
  // the slug shown in your Pixazo dashboard, e.g. "runway-gen4-5-text-to-video").
  if (p === "runway") return !!process.env.PIXAZO_API_KEY && !!process.env.PIXAZO_RUNWAY_MODEL?.trim();
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
// direct Runway/Luma. Override the whole order with VIDEO_API_CHAIN env var.
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

// --- Direct Runway REST client (bypasses Pixazo) -----------------------------
// TEMPORARY, admin-only override — see ClipRequest.preferDirectRunway above.
// Mirrors the client that was removed in "Route Runway through Pixazo; remove
// the direct Runway endpoint" (fe543ca); kept isolated here rather than back
// in the main provider chain so it can be deleted in one place later.
const RUNWAY_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";
const RUNWAY_MODEL = "gen4.5";

// image_to_video supports all ratios; text_to_video only supports landscape/portrait
const IMAGE_TO_VIDEO_RATIOS: Record<string, string> = {
  "16:9": "1280:720",
  "9:16": "720:1280",
  "4:3": "1104:832",
  "1:1": "960:960",
  "21:9": "1584:672",
};

// text_to_video gen4.5 only accepts these two ratios — map others to nearest
const TEXT_TO_VIDEO_RATIOS: Record<string, "1280:720" | "720:1280"> = {
  "16:9": "1280:720",
  "9:16": "720:1280",
  "4:3": "1280:720",
  "1:1": "1280:720",
  "21:9": "1280:720",
};

async function generateWithRunwayDirect(req: ClipRequest): Promise<string> {
  const apiKey = process.env.RUNWAY_API_KEY!;
  const duration = Math.min(Math.max(Math.ceil(req.durationSeconds), 2), 10);
  const aspectRatio = req.aspectRatio ?? "16:9";

  let endpoint: string;
  let body: Record<string, unknown>;

  if (req.imageUrl) {
    // image_to_video: use the provided HTTPS reference image URL
    endpoint = `${RUNWAY_BASE}/image_to_video`;
    body = {
      model: RUNWAY_MODEL,
      promptImage: req.imageUrl,
      promptText: req.prompt.slice(0, 1000),
      duration,
      ratio: IMAGE_TO_VIDEO_RATIOS[aspectRatio] ?? "1280:720",
    };
  } else {
    // text_to_video: no reference image, let the prompt drive everything
    endpoint = `${RUNWAY_BASE}/text_to_video`;
    body = {
      model: RUNWAY_MODEL,
      promptText: req.prompt.slice(0, 1000),
      duration,
      ratio: TEXT_TO_VIDEO_RATIOS[aspectRatio] ?? "1280:720",
    };
  }

  const genRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Runway-Version": RUNWAY_VERSION,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!genRes.ok)
    throw new Error(`Runway ${genRes.status}: ${(await genRes.text()).slice(0, 300)}`);
  const { id: taskId } = (await genRes.json()) as { id: string };

  for (let i = 0; i < 120; i++) {
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
      throw new Error(`Runway task failed: ${failMsg}`);
    }
  }
  throw new Error("Runway task timed out after 10 minutes");
}

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
async function generateWithPixazo(req: ClipRequest, t2vOverride?: string, i2vOverride?: string): Promise<string> {
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

  const body: Record<string, unknown> = {
    prompt: req.prompt.slice(0, 2500),
    duration,
  };
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

  const submit = await fetch(`https://gateway.pixazo.ai/${model}/v1/${model}-request`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) throw new Error(`${PROVIDER_API_FAILURE} Pixazo ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const submitData = (await submit.json()) as { request_id?: string; polling_url?: string };
  const requestId = submitData.request_id;
  if (!requestId) throw new Error(`${PROVIDER_API_FAILURE} Pixazo: no request_id returned`);
  const pollUrl = submitData.polling_url ?? `https://gateway.pixazo.ai/v2/requests/status/${requestId}`;

  // Persist the request id/poll URL before polling starts, so a clip that
  // completes after we stop polling is recoverable (never block the render on
  // a persistence hiccup, though).
  try {
    await req.onSubmit?.({ provider: "pixazo", requestId, pollUrl });
  } catch {
    /* non-fatal */
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
  throw new Error(`${PROVIDER_API_FAILURE} Pixazo task timed out after 10 minutes`);
}

function isCreditError(err: unknown): boolean {
  const m = String(err instanceof Error ? err.message : err).toLowerCase();
  return ["402", "credit", "quota", "insufficient", "exceeded", "payment", "balance"].some((s) => m.includes(s));
}

async function callProvider(provider: Provider, req: ClipRequest): Promise<string> {
  switch (provider) {
    case "runway":
      // TEMPORARY, admin-only: real Runway API instead of Pixazo's Runway
      // routing. See ClipRequest.preferDirectRunway. Pixazo is intentionally
      // NOT used as a fallback here — preferDirectRunway means "Runway only,
      // no Pixazo," so a missing key or a failed call surfaces as a real
      // error instead of silently billing through Pixazo.
      if (req.preferDirectRunway) {
        if (!process.env.RUNWAY_API_KEY) {
          throw new Error(
            "Direct Runway is enabled for this admin request (preferDirectRunway) but RUNWAY_API_KEY is not set — not falling back to Pixazo.",
          );
        }
        return generateWithRunwayDirect(req);
      }
      // Everyone else still runs through the Pixazo gateway.
      // PIXAZO_RUNWAY_MODEL / PIXAZO_RUNWAY_I2V_MODEL choose the slugs.
      return generateWithPixazo(
        req,
        process.env.PIXAZO_RUNWAY_MODEL!.trim(),
        process.env.PIXAZO_RUNWAY_I2V_MODEL?.trim(),
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

// Try providers in order, automatically falling back to the next on failure
// (e.g. Runway credits exhausted → Pixazo). Returns the first success.
export async function generateClip(req: ClipRequest): Promise<ClipResult | null> {
  let chain = getProviderChain();
  if (chain.length === 0) return null;

  // TEMPORARY, admin-only: preferDirectRunway means Runway ONLY — no
  // fallback to kling/pixazo/luma (kling and pixazo both bill through the
  // same Pixazo gateway this flag exists to avoid). See ClipRequest.preferDirectRunway.
  if (req.preferDirectRunway) {
    chain = ["runway"];
  } else {
    // Honor a user-chosen engine: pin it first, keeping the rest as fallback.
    const pinned = req.provider?.toLowerCase() as Provider | undefined;
    if (pinned && providerAvailable(pinned)) {
      chain = [pinned, ...chain.filter((p) => p !== pinned)];
    }
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
  if (!finalErr.message.includes(PROVIDER_API_FAILURE)) {
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
