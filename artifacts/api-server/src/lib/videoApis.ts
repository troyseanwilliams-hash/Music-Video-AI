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
}

export interface ClipResult {
  videoUrl: string;
  provider: string;
}

type Provider = "runway" | "luma" | "kling" | "pixazo" | "pixazo-runway";

function providerAvailable(p: Provider): boolean {
  if (p === "runway") return !!process.env.RUNWAY_API_KEY;
  if (p === "luma") return !!process.env.LUMA_API_KEY;
  // "kling" and "pixazo" run through the Pixazo gateway (single key).
  if (p === "kling") return !!process.env.PIXAZO_API_KEY;
  if (p === "pixazo") return !!process.env.PIXAZO_API_KEY;
  // "pixazo-runway" runs Runway through the Pixazo gateway. Requires both the
  // Pixazo key AND a model slug (set PIXAZO_RUNWAY_MODEL to the slug shown in
  // your Pixazo dashboard, e.g. "runway-gen4-5-text-to-video").
  if (p === "pixazo-runway") return !!process.env.PIXAZO_API_KEY && !!process.env.PIXAZO_RUNWAY_MODEL?.trim();
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
    order = ["kling", "pixazo-runway", "runway", "pixazo", "luma"];
    if (primary && order.includes(primary)) order = [primary, ...order.filter((p) => p !== primary)];
  }
  return order.filter(providerAvailable);
}

function getProvider(): Provider | null {
  return getProviderChain()[0] ?? null;
}

export function getActiveProvider(hint?: string | null): string {
  const h = hint?.toLowerCase() as Provider | undefined;
  if (h === "runway" && process.env.RUNWAY_API_KEY) return "runway";
  if (h === "kling" && process.env.PIXAZO_API_KEY) return "kling";
  if (h === "luma" && process.env.LUMA_API_KEY) return "luma";
  if (h === "pixazo" && process.env.PIXAZO_API_KEY) return "pixazo";
  if (h === "pixazo-runway" && providerAvailable("pixazo-runway")) return "pixazo-runway";
  return getProvider() ?? "simulation";
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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

async function generateWithRunway(req: ClipRequest): Promise<string> {
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

// After Runway reports out-of-credits, skip it for a while so we don't retry an
// exhausted account on every clip (cleared on the next successful Runway call).
let runwaySkipUntil = 0;

function isCreditError(err: unknown): boolean {
  const m = String(err instanceof Error ? err.message : err).toLowerCase();
  return ["402", "credit", "quota", "insufficient", "exceeded", "payment", "balance"].some((s) => m.includes(s));
}

async function callProvider(provider: Provider, req: ClipRequest): Promise<string> {
  switch (provider) {
    case "runway":
      return generateWithRunway(req);
    case "luma":
      return generateWithLuma(req);
    case "kling":
      // Kling runs through the Pixazo gateway; the model tier tracks resolution.
      return generateWithPixazo(req, klingModel(req.resolution));
    case "pixazo":
      return generateWithPixazo(req);
    case "pixazo-runway":
      // Runway via the Pixazo gateway.
      // PIXAZO_RUNWAY_MODEL     — text-to-video slug (required)
      // PIXAZO_RUNWAY_I2V_MODEL — image-to-video slug (used when a reference image is present)
      return generateWithPixazo(
        req,
        process.env.PIXAZO_RUNWAY_MODEL!.trim(),
        process.env.PIXAZO_RUNWAY_I2V_MODEL?.trim(),
      );
  }
  throw new Error(`Unknown video provider: ${provider}`);
}

// Try providers in order, automatically falling back to the next on failure
// (e.g. Runway credits exhausted → Pixazo). Returns the first success.
export async function generateClip(req: ClipRequest): Promise<ClipResult | null> {
  let chain = getProviderChain();
  if (chain.length === 0) return null;

  // Honor a user-chosen engine: pin it first, keeping the rest as fallback.
  const pinned = req.provider?.toLowerCase() as Provider | undefined;
  if (pinned && providerAvailable(pinned)) {
    chain = [pinned, ...chain.filter((p) => p !== pinned)];
  }

  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i]!;
    const isLast = i === chain.length - 1;
    // Skip a recently-exhausted Runway when there's another provider to try.
    if (provider === "runway" && runwaySkipUntil > Date.now() && !isLast) continue;
    try {
      const videoUrl = await callProvider(provider, req);
      if (provider === "runway") runwaySkipUntil = 0;
      return { videoUrl, provider };
    } catch (err) {
      lastErr = err;
      if (provider === "runway" && isCreditError(err)) {
        runwaySkipUntil = Date.now() + 6 * 60 * 60 * 1000; // 6h — fall back to the next provider
      }
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

export async function downloadClip(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Failed to download clip from ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
