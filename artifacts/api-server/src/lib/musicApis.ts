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

export type MusicProvider = "simulation" | "acestep" | "musicgen";

export interface SongRequest {
  prompt: string; // style/genre description
  lyrics?: string; // used by vocal models (acestep); ignored by musicgen
  durationSeconds: number; // target length
  provider?: MusicProvider; // explicit override
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

export function getActiveMusicProvider(hint?: MusicProvider | null): MusicProvider {
  const key = getEnv("REPLICATE_API_TOKEN");
  if (!key) return "simulation";
  if (hint === "acestep" && getEnv("MUSIC_ACESTEP_VERSION")) return "acestep";
  if (hint === "musicgen" && getEnv("MUSIC_MUSICGEN_VERSION")) return "musicgen";
  // Default preference: full-song vocal model, then instrumental.
  if (getEnv("MUSIC_ACESTEP_VERSION")) return "acestep";
  if (getEnv("MUSIC_MUSICGEN_VERSION")) return "musicgen";
  return "simulation";
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Replicate prediction runner ──────────────────────────────────────────────

async function runReplicate(version: string, input: Record<string, unknown>): Promise<string> {
  const token = getEnv("REPLICATE_API_TOKEN")!;
  const create = await fetch(`${REPLICATE_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ version, input }),
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

// ── Public entry ─────────────────────────────────────────────────────────────

// Songs can run up to 5 minutes (300s). Providers may cap lower internally.
export const MAX_SONG_SECONDS = 300;

export async function generateSong(req: SongRequest): Promise<SongResult> {
  const provider = getActiveMusicProvider(req.provider ?? null);
  const dur = Math.min(Math.max(req.durationSeconds || 30, 5), MAX_SONG_SECONDS);

  if (provider === "simulation") {
    return simulateSong(dur);
  }

  if (provider === "acestep") {
    const version = getEnv("MUSIC_ACESTEP_VERSION")!;
    // ACE-Step takes a style/tags prompt + lyrics. Field names follow the
    // common Replicate ACE-Step schema; adjust here if your pinned version
    // differs (kept in one place on purpose).
    const url = await runReplicate(version, {
      tags: req.prompt,
      lyrics: req.lyrics ?? "[inst]",
      duration: dur,
    });
    const { buffer, ext } = await downloadAudio(url);
    return { audioBuffer: buffer, ext, provider: "acestep", hasVocals: true };
  }

  // musicgen (instrumental)
  const version = getEnv("MUSIC_MUSICGEN_VERSION")!;
  const url = await runReplicate(version, {
    prompt: req.prompt,
    duration: dur,
    output_format: "mp3",
  });
  const { buffer, ext } = await downloadAudio(url);
  return { audioBuffer: buffer, ext, provider: "musicgen", hasVocals: false };
}
