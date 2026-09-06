import { withResourceLease } from "@workspace/db";

const API_BASE = "https://api.elevenlabs.io";
const MODEL_ID = "eleven_turbo_v2_5";
export const MIN_SCRIPT_CHARS = 40;
export const MAX_SCRIPT_CHARS = 39_000;
export const MUSIC_CREDITS = 4;
export const NARRATION_CREDITS_PER_1000 = 3;

export const NARRATION_VOICES = [
  { id: "E7olrBbFOdiUavKo8uDz", label: "Warm host — male" },
  { id: "RaWnUBci5FJ5T4uqLGpc", label: "Deep narrator — male" },
  { id: "7we13awk16GJEkpGnycg", label: "Calm narrator — female" },
  { id: "7wLo7aSUZ0MemuoKzScR", label: "Bright host — female" },
  { id: "9CYFpoHSBba0ruotnbC6", label: "Smooth late-night — male" },
  { id: "DCw3GzQBNsdk6GvatOgF", label: "Casual young — male" },
  { id: "X25SoP3Y3FA15EQHy7AZ", label: "Crisp British — female" },
  { id: "Q6w2fb9DypZ5oeNk3R95", label: "Gravelly veteran — male" },
  { id: "n7EhCDLzUbXsnnXcuC5a", label: "Playful quirky — female" },
  { id: "o7l3uDPo9s9vhmimPYUa", label: "Executive authoritative — female" },
] as const;

export function narrationCost(scriptLength: number, includeMusic = false): number {
  const narration = Math.max(3, Math.ceil(scriptLength / 1000) * NARRATION_CREDITS_PER_1000);
  return narration + (includeMusic ? MUSIC_CREDITS : 0);
}

export function defaultNarrationVoiceId(): string {
  const configured = process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (configured && NARRATION_VOICES.some((voice) => voice.id === configured)) return configured;
  return NARRATION_VOICES[0].id;
}

export function isAllowedNarrationVoice(voiceId: string): boolean {
  return NARRATION_VOICES.some((voice) => voice.id === voiceId);
}

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Narration service is not configured");
  return key;
}

export class ConclusiveNarrationError extends Error {
  constructor(readonly status: number) {
    super("Narration service rejected the request");
  }
}

// Only documented request-validation/authentication responses prove that the
// provider did not accept work.  In particular, 429 and every 5xx can happen
// after acceptance at an intermediary, so they are deliberately ambiguous.
export function isConclusivePreAcceptanceStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 422;
}

export class AmbiguousNarrationSubmissionError extends Error {
  constructor(readonly status?: number) {
    super("Narration submission outcome is uncertain");
  }
}

async function acceptedAudio(response: Response): Promise<{ buffer: Buffer; requestId: string | null }> {
  if (!response.ok) {
    if (isConclusivePreAcceptanceStatus(response.status)) throw new ConclusiveNarrationError(response.status);
    throw new AmbiguousNarrationSubmissionError(response.status);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("audio/")) throw new Error("Narration service returned an invalid response");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 256) throw new Error("Narration service returned empty audio");
  return { buffer, requestId: response.headers.get("request-id") ?? response.headers.get("x-request-id") };
}

export async function synthesizeNarration(
  text: string,
  voiceId: string,
  jobId?: string,
): Promise<{ buffer: Buffer; requestId: string | null }> {
  return withResourceLease("elevenlabs", async ({ signal }) => {
    const response = await fetch(
      `${API_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey(), "content-type": "application/json" },
        body: JSON.stringify({ text, model_id: MODEL_ID }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      },
    );
    return acceptedAudio(response);
  }, { jobId });
}

export async function synthesizeMusic(
  prompt: string,
  jobId?: string,
): Promise<{ buffer: Buffer; requestId: string | null }> {
  return withResourceLease("elevenlabs", async ({ signal }) => {
    const response = await fetch(`${API_BASE}/v1/music?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": apiKey(), "content-type": "application/json" },
      body: JSON.stringify({ prompt, music_length_ms: 300_000, force_instrumental: true }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    });
    return acceptedAudio(response);
  }, { jobId });
}

const previewCache = new Map<string, Buffer>();
export async function narrationVoicePreview(voiceId: string): Promise<Buffer> {
  const cached = previewCache.get(voiceId);
  if (cached) return cached;
  const result = await synthesizeNarration(
    "Welcome to AIBeatSync. This is a short sample of your narration voice.",
    voiceId,
  );
  previewCache.set(voiceId, result.buffer);
  return result.buffer;
}