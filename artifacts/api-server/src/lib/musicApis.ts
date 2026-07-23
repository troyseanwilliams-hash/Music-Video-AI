// AI song generation — provider abstraction, mirroring videoApis.ts.
//
// Providers (selected by env, safe simulation fallback when no key):
//   - simulation : silent/placeholder tone, no key needed (dev + demo)
//   - acestep    : ACE-Step via Replicate — full songs WITH vocals/lyrics
//                  (Apache-2.0 model, commercial use OK)
//   - musicgen   : Meta MusicGen via Replicate — instrumental only
//
// Suno is intentionally NOT wired here yet — drop it in as another provider
// once their public API ships. Nothing calls this outside the admin routes,
// so it stays isolated from the product until you're ready to expose it.

export type MusicProvider = "simulation" | "acestep" | "musicgen" | "pixazo";

export interface SongRequest {
  prompt: string; // style/genre description
  lyrics?: string; // used by vocal models (acestep); ignored by musicgen
  durationSeconds: number; // target length
  provider?: MusicProvider; // explicit override
  useFreeModel?: boolean; // route free-tier tracks to the $0 Pixazo model
}

export interface SongResult {
  audioBuffer: Buffer;
  ext: string; // "mp3" | "wav"
  provider: MusicProvider;
  hasVocals: boolean;
}

const REPLICATE_BASE = "https://api.replicate.com/v1";

// Replicate model versions are pinned via env so you can update them without a
// code change (Replicate rotates hashes). Set these when you connect the key.
//   MUSIC_ACESTEP_VERSION  — an ACE-Step model version hash on Replicate
//   MUSIC_MUSICGEN_VERSION — a MusicGen model version hash on Replicate
function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

// ACE-Step (vocals) needs an explicit model/version. Instrumental MusicGen
// works with just the token — it defaults to the public "meta/musicgen" slug.
function aceStepConfigured(): boolean {
  return !!(getEnv("MUSIC_ACESTEP_VERSION") || getEnv("MUSIC_ACESTEP_MODEL"));
}

export function getActiveMusicProvider(hint?: MusicProvider | null): MusicProvider {
  const hasPixazo = !!getEnv("PIXAZO_API_KEY");
  const hasReplicate = !!getEnv("REPLICATE_API_TOKEN");
  // Explicit Replicate hints win when Replicate is configured.
  if (hasReplicate && hint === "acestep" && aceStepConfigured()) return "acestep";
  if (hasReplicate && hint === "musicgen") return "musicgen";
  // Prefer Pixazo — one key shared with the video provider, no Replicate needed.
  if (hasPixazo) return "pixazo";
  if (hasReplicate) return "musicgen"; // free/cheap instrumental
  return "simulation";
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Replicate prediction runner ──────────────────────────────────────────────

// Accepts either a pinned version hash (40+ hex chars) or an "owner/name" model
// slug. Slugs hit the model endpoint (latest version) so no hash hunting is
// needed — e.g. "meta/musicgen" works out of the box.
async function runReplicate(modelOrVersion: string, input: Record<string, unknown>): Promise<string> {
  const token = getEnv("REPLICATE_API_TOKEN")!;
  const isVersion = /^[0-9a-f]{40,}$/i.test(modelOrVersion);
  const url = isVersion
    ? `${REPLICATE_BASE}/predictions`
    : `${REPLICATE_BASE}/models/${modelOrVersion}/predictions`;
  const body = isVersion ? { version: modelOrVersion, input } : { input };
  const create = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!create.ok) {
    throw new Error(`Replicate create failed (${create.status}): ${(await create.text()).slice(0, 300)}`);
  }
  const prediction = (await create.json()) as {
    id: string;
    urls?: { get?: string };
    status?: string;
    output?: unknown;
    error?: string;
  };

  const getUrl = prediction.urls?.get ?? `${REPLICATE_BASE}/predictions/${prediction.id}`;

  // Poll up to ~4 minutes.
  for (let i = 0; i < 120; i++) {
    await delay(2000);
    const poll = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!poll.ok) continue;
    const data = (await poll.json()) as { status: string; output?: unknown; error?: string };
    if (data.status === "succeeded") {
      // Output is a URL string or an array of URLs — take the first audio URL.
      const out = data.output;
      const url = Array.isArray(out) ? String(out[0]) : String(out);
      if (!url || !url.startsWith("http")) throw new Error("Replicate returned no audio URL");
      return url;
    }
    if (data.status === "failed" || data.status === "canceled") {
      throw new Error(`Replicate generation ${data.status}: ${data.error ?? "unknown error"}`);
    }
  }
  throw new Error("Replicate generation timed out");
}

async function downloadAudio(url: string): Promise<{ buffer: Buffer; ext: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download generated audio (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = url.toLowerCase().includes(".wav") ? "wav" : "mp3";
  return { buffer, ext };
}

// ── Simulation (no key) ──────────────────────────────────────────────────────

async function simulateSong(durationSeconds: number): Promise<SongResult> {
  // Generate a short, quiet sine-tone placeholder with ffmpeg so the whole
  // pipeline (storage, playback, analysis) works end-to-end without a key.
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { readFile, unlink } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const execAsync = promisify(exec);
  const out = join(tmpdir(), `bv_song_${randomUUID()}.mp3`);
  // Honor the requested length (so the length selector is visibly working),
  // capped at 5.5 min like the real providers.
  const dur = Math.min(Math.max(durationSeconds, 5), MAX_SONG_SECONDS);
  try {
    await execAsync(
      `ffmpeg -y -f lavfi -i "sine=frequency=220:duration=${dur}" ` +
        `-f lavfi -i "sine=frequency=330:duration=${dur}" ` +
        `-filter_complex "[0:a][1:a]amix=inputs=2,volume=0.25" ` +
        `-c:a libmp3lame -b:a 128k "${out}"`,
      { timeout: 30_000 },
    );
    const buffer = await readFile(out);
    return { audioBuffer: buffer, ext: "mp3", provider: "simulation", hasVocals: false };
  } finally {
    await unlink(out).catch(() => {});
  }
}

// ── Pixazo (unified gateway) ─────────────────────────────────────────────────
// Uses the same PIXAZO_API_KEY as the video provider. Submits to a music model
// endpoint, polls the universal status endpoint, returns the audio URL. Defaults
// to MiniMax Music with is_instrumental=true; override the model/operation via
// PIXAZO_MUSIC_MODEL / PIXAZO_MUSIC_OP.
async function generateWithPixazoMusic(req: SongRequest): Promise<string> {
  const key = getEnv("PIXAZO_API_KEY")!;
  // Default to Stable Audio 3 Small — a cheap, per-second text-to-audio model —
  // NOT the flat-priced ($0.15/gen) MiniMax. The op is "<model>-request", so the
  // full call is /stable-audio-3-small-music-text-to-audio/v1/<model>-request.
  // Free-tier tracks use PIXAZO_FREE_MUSIC_MODEL when set; override slug/op via env.
  const DEFAULT_MUSIC_MODEL = "stable-audio-3-small-music-text-to-audio";
  const freeModel = getEnv("PIXAZO_FREE_MUSIC_MODEL");
  const model = req.useFreeModel && freeModel ? freeModel : getEnv("PIXAZO_MUSIC_MODEL") || DEFAULT_MUSIC_MODEL;
  const op = getEnv("PIXAZO_MUSIC_OP") || `${model}-request`;
  const duration = Math.min(Math.max(req.durationSeconds || 10, 3), MAX_SONG_SECONDS);
  const wantsVocals = !!(req.lyrics && req.lyrics.trim() && req.lyrics.trim() !== "[inst]");

  // Request body differs by model family: MiniMax (full songs) uses
  // is_instrumental/lyrics and ignores duration; MusicGen/Stable Audio are
  // instrumental per-second models that honor a short duration.
  const isMinimax = /minimax/i.test(model);
  const body = isMinimax
    ? { prompt: req.prompt, is_instrumental: !wantsVocals, ...(wantsVocals ? { lyrics: req.lyrics } : {}) }
    : { prompt: req.prompt, duration };

  const submit = await fetch(`https://gateway.pixazo.ai/${model}/v1/${op}`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    throw new Error(`Pixazo music error (${submit.status}): ${(await submit.text()).slice(0, 300)}`);
  }
  const data = (await submit.json()) as { request_id?: string; polling_url?: string };
  const requestId = data.request_id;
  if (!requestId) throw new Error("Pixazo music: no request_id returned");
  const pollUrl = data.polling_url ?? `https://gateway.pixazo.ai/v2/requests/status/${requestId}`;

  for (let i = 0; i < 120; i++) {
    await delay(3000);
    const poll = await fetch(pollUrl, { headers: { "Ocp-Apim-Subscription-Key": key } });
    if (!poll.ok) continue;
    const d = (await poll.json()) as { status?: string; error?: string | null; output?: { media_url?: string[] } };
    if (d.status === "COMPLETED" && d.output?.media_url?.[0]) return d.output.media_url[0];
    if (d.status === "FAILED" || d.status === "ERROR") throw new Error(`Pixazo music ${d.status}: ${d.error ?? "unknown error"}`);
  }
  throw new Error("Pixazo music generation timed out");
}

// Loop a short clip to fill a target length (free — pure ffmpeg, no AI cost).
// Lets you generate a cheap 5–10s loop and repeat it to match a video.
export async function loopAudioToLength(
  buffer: Buffer,
  ext: string,
  targetSeconds: number,
): Promise<{ buffer: Buffer; ext: string }> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { readFile, writeFile, unlink } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const execAsync = promisify(exec);
  const id = randomUUID();
  const inPath = join(tmpdir(), `bv_loopin_${id}.${ext || "mp3"}`);
  const outPath = join(tmpdir(), `bv_loopout_${id}.mp3`);
  const target = Math.min(Math.max(Math.round(targetSeconds), 1), MAX_SONG_SECONDS);
  try {
    await writeFile(inPath, buffer);
    // -stream_loop -1 repeats the clip indefinitely; -t cuts it at the target.
    // A short fade in/out trims any hard edges at the ends.
    await execAsync(
      `ffmpeg -y -stream_loop -1 -i "${inPath}" -t ${target} ` +
        `-af "afade=t=in:st=0:d=0.05,afade=t=out:st=${Math.max(0, target - 0.1)}:d=0.1" ` +
        `-c:a libmp3lame -b:a 192k "${outPath}"`,
      { timeout: 60_000 },
    );
    return { buffer: await readFile(outPath), ext: "mp3" };
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

// ── Public entry ─────────────────────────────────────────────────────────────

// Songs can run up to ~5.5 minutes (330s) so "Full" length lands around a
// natural full-song runtime. Providers may cap lower internally.
export const MAX_SONG_SECONDS = 330;

export async function generateSong(req: SongRequest): Promise<SongResult> {
  const provider = getActiveMusicProvider(req.provider ?? null);
  const dur = Math.min(Math.max(req.durationSeconds || 30, 5), MAX_SONG_SECONDS);

  if (provider === "simulation") {
    return simulateSong(dur);
  }

  if (provider === "pixazo") {
    const url = await generateWithPixazoMusic(req);
    const { buffer, ext } = await downloadAudio(url);
    const hasVocals = !!(req.lyrics && req.lyrics.trim() && req.lyrics.trim() !== "[inst]");
    return { audioBuffer: buffer, ext, provider: "pixazo", hasVocals };
  }

  if (provider === "acestep") {
    // ACE-Step takes a style/tags prompt + lyrics. Configure via a model slug
    // (MUSIC_ACESTEP_MODEL) or a pinned version (MUSIC_ACESTEP_VERSION).
    const model = getEnv("MUSIC_ACESTEP_MODEL") || getEnv("MUSIC_ACESTEP_VERSION")!;
    const url = await runReplicate(model, {
      tags: req.prompt,
      lyrics: req.lyrics ?? "[inst]",
      duration: dur,
    });
    const { buffer, ext } = await downloadAudio(url);
    return { audioBuffer: buffer, ext, provider: "acestep", hasVocals: true };
  }

  // musicgen (instrumental) — defaults to the public "meta/musicgen" model slug
  // so it works with just REPLICATE_API_TOKEN (no version hash needed). Override
  // with MUSIC_MUSICGEN_MODEL (slug) or MUSIC_MUSICGEN_VERSION (pinned hash).
  const model = getEnv("MUSIC_MUSICGEN_MODEL") || getEnv("MUSIC_MUSICGEN_VERSION") || "meta/musicgen";
  const url = await runReplicate(model, {
    prompt: req.prompt,
    duration: dur,
    output_format: "mp3",
    normalization_strategy: "peak",
  });
  const { buffer, ext } = await downloadAudio(url);
  return { audioBuffer: buffer, ext, provider: "musicgen", hasVocals: false };
}
