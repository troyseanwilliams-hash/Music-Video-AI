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

function parsedTrustedUrl(raw: string, hosts: Set<string>): URL | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
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

async function fetchTrustedSuno(url: string, hosts: Set<string>, init: RequestInit): Promise<Response> {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (!parsedTrustedUrl(current, hosts)) throw new Error("Untrusted Suno download location");
    const response = await fetch(current, { ...init, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(30_000) });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Audio download redirect was invalid");
    current = new URL(location, current).toString();
  }
  throw new Error("Audio download redirected too many times");
}

export function extractSunoId(url: string): string | null {
  if (!isCanonicalSunoShareUrl(url)) return null;
  const match = url.match(/\/song\/([a-f0-9-]{36})/i);
  return match?.[1] ?? null;
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export async function resolveSunoUrl(url: string): Promise<SunoTrack> {
  const songId = extractSunoId(url);
  if (!songId) throw new Error("Not a valid Suno share URL");

  const audioUrl = `https://${TRUSTED_SUNO_CDN_HOST}/${songId}.mp3`;

  // Verify the audio file exists on the CDN
  const headRes = await fetchTrustedSunoCdn(audioUrl, { method: "HEAD" });
  if (!headRes.ok) {
    throw new Error(
      `Track not found on Suno CDN (status ${headRes.status}). Make sure the song is public.`,
    );
  }

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
