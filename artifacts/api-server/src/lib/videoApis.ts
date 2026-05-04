import { createHmac } from "crypto";

export interface ClipRequest {
  prompt: string;
  durationSeconds: number;
  aspectRatio?: string;
}

export interface ClipResult {
  videoUrl: string;
  provider: string;
}

type Provider = "runway" | "luma" | "kling";

function getProvider(): Provider | null {
  const env = process.env.VIDEO_API?.toLowerCase();
  if (env === "runway" && process.env.RUNWAY_API_KEY) return "runway";
  if (env === "luma" && process.env.LUMA_API_KEY) return "luma";
  if (env === "kling" && process.env.KLING_API_KEY) return "kling";
  if (process.env.RUNWAY_API_KEY) return "runway";
  if (process.env.LUMA_API_KEY) return "luma";
  if (process.env.KLING_API_KEY) return "kling";
  return null;
}

export function getActiveProvider(): string {
  return getProvider() ?? "simulation";
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateWithRunway(req: ClipRequest): Promise<string> {
  const apiKey = process.env.RUNWAY_API_KEY!;
  const duration = Math.min(Math.max(Math.ceil(req.durationSeconds), 5), 10);

  const genRes = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify({
      model: "gen3a_turbo",
      promptText: req.prompt.slice(0, 1000),
      duration,
      ratio: req.aspectRatio === "9:16" ? "720:1280" : "1280:768",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!genRes.ok)
    throw new Error(`Runway ${genRes.status}: ${(await genRes.text()).slice(0, 200)}`);
  const { id: taskId } = (await genRes.json()) as { id: string };

  for (let i = 0; i < 120; i++) {
    await delay(5000);
    const pollRes = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, "X-Runway-Version": "2024-11-06" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pollRes.ok) continue;
    const task = (await pollRes.json()) as {
      status: string;
      output?: string[];
      failure?: { message?: string };
    };
    if (task.status === "SUCCEEDED" && task.output?.[0]) return task.output[0];
    if (task.status === "FAILED")
      throw new Error(`Runway task failed: ${task.failure?.message}`);
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

export async function generateClip(req: ClipRequest): Promise<ClipResult | null> {
  const provider = getProvider();
  if (!provider) return null;

  let videoUrl: string;
  switch (provider) {
    case "runway":
      videoUrl = await generateWithRunway(req);
      break;
    case "luma":
      videoUrl = await generateWithLuma(req);
      break;
    case "kling":
      videoUrl = await generateWithKling(req);
      break;
  }
  return { videoUrl, provider };
}

export async function downloadClip(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Failed to download clip from ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
