// Pixazo lip sync: turn a reference face image + an audio track into a talking /
// singing avatar video. Mirrors the Kling gateway submit → poll pattern used in
// videoApis.ts. Set PIXAZO_LIPSYNC_MODEL to the exact model slug from your Pixazo
// dashboard (an OmniHuman-style image-to-video lipsync model); the default is a
// best-guess slug that you should override once you confirm it.

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lipsyncModel(): string {
  return process.env.PIXAZO_LIPSYNC_MODEL?.trim() || "omnihuman";
}

export function lipsyncAvailable(): boolean {
  return !!process.env.PIXAZO_API_KEY;
}

// Submit an image + audio and poll for the finished lipsync MP4 URL.
export async function generateLipsync(params: { imageUrl: string; audioUrl: string }): Promise<string> {
  const key = process.env.PIXAZO_API_KEY;
  if (!key) throw new Error("Lip sync requires PIXAZO_API_KEY");
  const model = lipsyncModel();

  const submit = await fetch(`https://gateway.pixazo.ai/${model}/v1/${model}-request`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: params.imageUrl, audio_url: params.audioUrl }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) {
    throw new Error(`Pixazo lipsync ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  }
  const data = (await submit.json()) as { request_id?: string; polling_url?: string };
  const requestId = data.request_id;
  if (!requestId) throw new Error("Pixazo lipsync: no request_id returned");
  const pollUrl = data.polling_url ?? `https://gateway.pixazo.ai/v2/requests/status/${requestId}`;

  // Lipsync (esp. OmniHuman) can be slow — poll up to ~15 min.
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
