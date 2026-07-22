import { createHmac } from "crypto";

export interface ClipRequest {
  prompt: string;
  durationSeconds: number;
  aspectRatio?: string;
  /** HTTPS URL of the reference image (GCS signed URL). When absent, text_to_video is used. */
  imageUrl?: string;
}

export interface ClipResult {
  videoUrl: string;
  provider: string;
}

type Provider = "runway" | "luma" | "kling" | "pixazo";

function providerAvailable(p: Provider): boolean {
  if (p === "runway") return !!process.env.RUNWAY_API_KEY;
  if (p === "luma") return !!process.env.LUMA_API_KEY;
  if (p === "kling") return !!process.env.KLING_API_KEY;
  if (p === "pixazo") return !!process.env.PIXAZO_API_KEY;
  return false;
}

// Ordered provider chain with automatic fallback. Default order runs Runway
// first (to burn existing Runway credits), then Pixazo, then Kling/Luma —
// filtered to providers whose keys are set. So with only RUNWAY_API_KEY it uses
// Runway; add PIXAZO_API_KEY and Pixazo becomes the automatic fallback.
// Override the whole order with VIDEO_API_CHAIN="pixazo,runway"; VIDEO_API pins
// the primary.
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
    order = ["runway", "pixazo", "kling", "luma"];
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
  if (h === "kling" && process.env.KLING_API_KEY) return "kling";
  if (h === "luma" && process.env.LUMA_API_KEY) return "luma";
  if (h === "pixazo" && process.env.PIXAZO_API_KEY) return "pixazo";
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

function makeKlingJWT(accessKeyId: string, secretKey: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ iss: accessKeyId, exp: now + 1800, nbf: now - 5 }),
  ).toString("base64url");
  const sig = createHmac("sha256", secretKey)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

async function generateWithKling(req: ClipRequest): Promise<string> {
  const [accessKeyId, secretKey] = (process.env.KLING_API_KEY ?? ":").split(":");
  if (!accessKeyId || !secretKey) throw new Error("Invalid KLING_API_KEY format (expected accessKeyId:secretKey)");

  const duration = req.durationSeconds <= 5 ? "5" : "10";

  const genRes = await fetch("https://api.klingai.com/v1/videos/text2video", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${makeKlingJWT(accessKeyId, secretKey)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: "kling-v1",
      prompt: req.prompt.slice(0, 2500),
      negative_prompt: "blur, pixelated, low quality, watermark",
      cfg_scale: 0.5,
      mode: "std",
      duration,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!genRes.ok)
    throw new Error(`Kling ${genRes.status}: ${(await genRes.text()).slice(0, 200)}`);
  const { data } = (await genRes.json()) as { data: { task_id: string } };
  const taskId = data.task_id;

  for (let i = 0; i < 120; i++) {
    await delay(5000);
    const pollRes = await fetch(
      `https://api.klingai.com/v1/videos/text2video/${taskId}`,
      {
        headers: { Authorization: `Bearer ${makeKlingJWT(accessKeyId, secretKey)}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!pollRes.ok) continue;
    const { data: d } = (await pollRes.json()) as {
      data: {
        task_status: string;
        task_result?: { videos?: { url: string }[] };
      };
    };
    if (d.task_status === "succeed" && d.task_result?.videos?.[0]?.url)
      return d.task_result.videos[0].url;
    if (d.task_status === "failed") throw new Error("Kling task failed");
  }
  throw new Error("Kling task timed out after 10 minutes");
}

// Pixazo (pixazo.ai) — a unified gateway that fronts Kling, Runway, Veo, etc.
// behind one API key (Ocp-Apim-Subscription-Key). Submit to a model endpoint,
// then poll the universal status endpoint for the result. Pick your exact model
// slug from the Pixazo dashboard and set it as PIXAZO_MODEL.
async function generateWithPixazo(req: ClipRequest): Promise<string> {
  const key = process.env.PIXAZO_API_KEY!;
  const model = process.env.PIXAZO_MODEL?.trim() || "kling-video-v3-turbo-pro-text-to-video";
  const duration = req.durationSeconds <= 5 ? "5" : "10";

  const submit = await fetch(`https://gateway.pixazo.ai/${model}/v1/${model}-request`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: req.prompt.slice(0, 2500), duration }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) throw new Error(`Pixazo ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const submitData = (await submit.json()) as { request_id?: string; polling_url?: string };
  const requestId = submitData.request_id;
  if (!requestId) throw new Error("Pixazo: no request_id returned");
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
    if (d.status === "FAILED" || d.status === "ERROR") throw new Error(`Pixazo ${d.status}: ${d.error ?? "unknown error"}`);
  }
  throw new Error("Pixazo task timed out after 10 minutes");
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
      return generateWithKling(req);
    case "pixazo":
      return generateWithPixazo(req);
  }
  throw new Error(`Unknown video provider: ${provider}`);
}

// Try providers in order, automatically falling back to the next on failure
// (e.g. Runway credits exhausted → Pixazo). Returns the first success.
export async function generateClip(req: ClipRequest): Promise<ClipResult | null> {
  const chain = getProviderChain();
  if (chain.length === 0) return null;

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
  throw lastErr instanceof Error ? lastErr : new Error("All video providers failed");
}

export async function downloadClip(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Failed to download clip from ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
