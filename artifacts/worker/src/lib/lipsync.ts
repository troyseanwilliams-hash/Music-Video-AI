// Pixazo lip sync: turn a reference face image + an audio track into a talking /
// singing avatar video. Mirrors the Kling gateway submit → poll pattern used in
// videoApis.ts. Defaults to ByteDance OmniHuman v1.5 on Pixazo; override the
// slug/op/resolution with the PIXAZO_LIPSYNC_* envs if needed.
import { withResourceLease } from "@workspace/db";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_LIPSYNC_MODEL = "bytedance-omnihuman-v1-5-290";

function lipsyncModel(): string {
  return process.env.PIXAZO_LIPSYNC_MODEL?.trim() || DEFAULT_LIPSYNC_MODEL;
}

function lipsyncOp(model: string): string {
  const override = process.env.PIXAZO_LIPSYNC_OP?.trim();
  if (override) return override;
  if (model === DEFAULT_LIPSYNC_MODEL) return "bytedance-omnihuman-v1-5-request";
  return `${model}-request`;
}

export function lipsyncAvailable(): boolean {
  return !!process.env.PIXAZO_API_KEY;
}

export async function generateLipsync(params: {
  imageUrl: string;
  audioUrl: string;
  existingPollUrl?: string | null;
  onSubmitted?: (pollUrl: string) => Promise<void>;
}): Promise<string> {
  const key = process.env.PIXAZO_API_KEY;
  if (!key) throw new Error("Lip sync requires PIXAZO_API_KEY");
  let pollUrl = params.existingPollUrl?.trim() || null;

  if (!pollUrl) {
    const model = lipsyncModel();
    const op = lipsyncOp(model);
    const resolution = process.env.PIXAZO_LIPSYNC_RESOLUTION?.trim() || "720p";
    const submit = await withResourceLease("gateway_video_submission", (lease) => fetch(`https://gateway.pixazo.ai/${model}/v1/${op}`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: params.imageUrl, audio_url: params.audioUrl, resolution }),
      signal: AbortSignal.any([AbortSignal.timeout(30_000), lease.signal]),
    }));
    if (!submit.ok) {
      throw new Error(`Pixazo lipsync ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
    }
    const data = (await submit.json()) as { request_id?: string; polling_url?: string };
    const requestId = data.request_id;
    if (!requestId) throw new Error("Pixazo lipsync: no request_id returned");
    pollUrl = data.polling_url ?? `https://gateway.pixazo.ai/v2/requests/status/${requestId}`;
    await params.onSubmitted?.(pollUrl);
  }

  for (let i = 0; i < 180; i++) {
    await delay(5000);
    const res = await fetch(pollUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) continue;
    const d = (await res.json()) as {
      status?: string;
      error?: string | null;
      output?: { media_url?: string[] };
    };
    if (d.status === "COMPLETED" && d.output?.media_url?.[0]) return d.output.media_url[0];
    if (d.status === "FAILED" || d.status === "ERROR") {
      throw new Error(`Pixazo lipsync ${d.status}: ${d.error ?? "unknown error"}`);
    }
  }
  throw new Error("Pixazo lipsync timed out after 15 minutes");
}