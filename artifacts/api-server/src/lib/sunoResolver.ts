/**
 * Resolves a Suno share URL to a direct audio CDN URL + metadata.
 *
 * Suno pages are now fully JS-rendered (no __NEXT_DATA__ in static HTML),
 * so we skip scraping entirely. Suno CDN URLs follow a predictable pattern:
 *   https://cdn1.suno.ai/{songId}.mp3
 *
 * We verify the file exists with a HEAD request, then return the URL.
 * A best-effort attempt to fetch the og:title is also made for display.
 */

export interface SunoTrack {
  audioUrl: string;
  title: string;
  artist: string;
}

const CANONICAL_SUNO_HOSTS = new Set(["suno.com", "www.suno.com", "suno.ai", "www.suno.ai"]);
export const TRUSTED_SUNO_CDN_HOST = "cdn1.suno.ai";
const MAX_REDIRECTS = 3;
const PROBE_BYTES = 1024;

function parsedTrustedUrl(raw: string, hosts: Set<string>): URL | null {
  try {
    const url = new URL(raw);
    // URL normalizes the default :443 port away; reject it explicitly too.
    const authority = /^https:\/\/([^/?#]+)/i.exec(raw)?.[1] ?? "";
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || authority.includes(":")
      || !hosts.has(url.hostname.toLowerCase())
    ) return null;
    return url;
  } catch {
    return null;
  }
}

export function isCanonicalSunoShareUrl(raw: string): boolean {
  const url = parsedTrustedUrl(raw, CANONICAL_SUNO_HOSTS);
  return Boolean(url && /^\/song\/[a-f0-9-]{36}\/?$/i.test(url.pathname));
}

export function isTrustedSunoCdnUrl(raw: string): boolean {
  return Boolean(parsedTrustedUrl(raw, new Set([TRUSTED_SUNO_CDN_HOST])));
}

export async function fetchTrustedSunoCdn(url: string, init: RequestInit = {}): Promise<Response> {
  return fetchTrustedSuno(url, new Set([TRUSTED_SUNO_CDN_HOST]), init);
}

// Only for jobs accepted before imports began storing an owned audioObjectPath.
// New render jobs must use the imported object; legacy CDN downloads remain
// allowlisted and bounded even if the remote server ignores Content-Length.
export async function downloadLegacySunoAudio(url: string): Promise<Buffer> {
  if (!isTrustedSunoCdnUrl(url)) throw new Error("Legacy Suno audio URL is not a trusted CDN URL. Re-import the song.");
  let response: Response;
  try {
    response = await fetchTrustedSunoCdn(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    if (err instanceof Error && /Untrusted|redirect/.test(err.message)) throw err;
    throw new Error("Legacy Suno CDN is unreachable or timed out. Re-import the song or try again later.", { cause: err });
  }
  if (!response.ok) throw new Error(`Legacy Suno audio is unavailable (status ${response.status}). Re-import the song.`);
  if (!audioType(response)) {
    await response.body?.cancel();
    throw new Error("Legacy Suno CDN returned a page instead of audio. Re-import the song.");
  }
  const limit = 50 * 1024 * 1024;
  if (Number(response.headers.get("content-length") ?? "0") > limit) {
    await response.body?.cancel();
    throw new Error("Legacy Suno audio exceeds the import size limit. Re-import the song.");
  }
  if (!response.body) throw new Error("Legacy Suno CDN returned no audio. Re-import the song.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Legacy Suno audio exceeds the import size limit. Re-import the song.");
      chunks.push(value);
    }
  } finally {
    if (size > limit) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks);
  if (!(buffer.length >= 3 && (
    buffer.subarray(0, 3).toString("ascii") === "ID3"
    || (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0)
  ))) throw new Error("Legacy Suno CDN returned invalid MP3 audio. Re-import the song.");
  return buffer;
}

async function fetchTrustedSuno(url: string, hosts: Set<string>, init: RequestInit): Promise<Response> {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (!parsedTrustedUrl(current, hosts)) throw new Error("Untrusted Suno download location");
    const response = await fetch(current, { ...init, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(30_000) });
    if (response.status < 300 || response.status >= 400) return response;
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Audio download redirect was invalid");
    await response.body?.cancel();
    current = new URL(location, current).toString();
  }
  throw new Error("Audio download redirected too many times");
}

export function extractSunoId(url: string): string | null {
  if (!isCanonicalSunoShareUrl(url)) return null;
  const match = new URL(url).pathname.match(/^\/song\/([a-f0-9-]{36})\/?$/i);
  return match?.[1] ?? null;
}

export function isSunoShareUrl(raw: string): boolean {
  const url = parsedTrustedUrl(raw, CANONICAL_SUNO_HOSTS);
  return Boolean(url && (isCanonicalSunoShareUrl(raw) || /^\/s\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)));
}

async function resolveShareId(raw: string): Promise<string> {
  const canonicalId = extractSunoId(raw);
  if (canonicalId) return canonicalId;
  if (!isSunoShareUrl(raw)) throw new Error("Not a valid Suno share URL");
  let current = raw;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (!parsedTrustedUrl(current, CANONICAL_SUNO_HOSTS)) throw new Error("Untrusted Suno share redirect");
    const id = extractSunoId(current);
    if (id) return id;
    let response: Response;
    try {
      response = await fetch(current, {
        method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000),
      });
      if (response.status === 405 || response.status === 501) {
        await response.body?.cancel();
        response = await fetch(current, {
          method: "GET", headers: { Range: "bytes=0-0" },
          redirect: "manual", signal: AbortSignal.timeout(8000),
        });
      }
    } catch {
      throw new Error("Could not check Suno short link (network timeout or Suno unavailable). Try again later.");
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      throw new Error("Suno short link did not redirect to a song. Check that the link is public.");
    }
    current = new URL(location, current).toString();
  }
  throw new Error("Suno share link redirected too many times");
}

function audioType(response: Response): boolean {
  return /^audio\/(mpeg|mp3|x-mpeg|mpeg3)(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "");
}

async function verifyAudio(audioUrl: string): Promise<void> {
  let head: Response | undefined;
  try {
    head = await fetchTrustedSunoCdn(audioUrl, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    if (head.ok && audioType(head)) return;
  } catch {
    // Some public CDN tracks disallow HEAD; try a bounded range GET.
  } finally {
    await head?.body?.cancel();
  }
  let probe: Response;
  try {
    probe = await fetchTrustedSunoCdn(audioUrl, {
      method: "GET", headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    if (err instanceof Error && /Untrusted|redirected|redirect was invalid/.test(err.message)) throw err;
    throw new Error("Could not check Suno audio (network timeout or CDN unavailable). Try again later.");
  }
  try {
    if (!probe.ok) {
      if (probe.status === 403 || probe.status === 404) {
        throw new Error(`Suno audio is unavailable (status ${probe.status}). Make sure the song is public and accessible.`);
      }
      throw new Error(`Could not access Suno audio (status ${probe.status}). Try again later.`);
    }
    const reader = probe.body?.getReader();
    if (!reader) throw new Error("Suno returned no audio content.");
    let bytes = new Uint8Array(0);
    try {
      while (bytes.length < PROBE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = PROBE_BYTES - bytes.length;
        const next = new Uint8Array(bytes.length + Math.min(remaining, value.length));
        next.set(bytes);
        next.set(value.subarray(0, remaining), bytes.length);
        bytes = next;
        if (bytes.length >= 3) break;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (
      bytes.length < 3
      || !((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
        || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0))
    ) throw new Error("Suno returned a page or invalid audio instead of an MP3.");
  } finally {
    await probe.body?.cancel().catch(() => {});
  }
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export async function resolveSunoUrl(url: string): Promise<SunoTrack> {
  const songId = await resolveShareId(url);

  const audioUrl = `https://${TRUSTED_SUNO_CDN_HOST}/${songId}.mp3`;

  // Verify the audio file exists on the CDN
  await verifyAudio(audioUrl);

  // Best-effort: fetch og:title from the share page for a nicer display name.
  // If this fails we just fall back to the song ID — audio still works fine.
  let title = songId;
  let artist = "Suno";

  try {
    const pageRes = await fetchTrustedSuno(`https://suno.com/song/${songId}`, CANONICAL_SUNO_HOSTS, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(6000),
    });

    if (pageRes.ok) {
      const html = await pageRes.text();

      const ogTitle = html.match(
        /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/,
      );
      if (ogTitle?.[1]) title = ogTitle[1];

      const ogDesc = html.match(
        /<meta[^>]+name="description"[^>]+content="([^"]+)"/,
      );
      if (ogDesc?.[1]) {
        const byMatch = ogDesc[1].match(/by ([^.]+)/i);
        if (byMatch?.[1]) artist = byMatch[1].trim();
      }
    }
  } catch {
    // Metadata fetch failed — not fatal, audio URL is already verified.
  }

  return { audioUrl, title, artist };
}
