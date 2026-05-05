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

export function extractSunoId(url: string): string | null {
  const match = url.match(/suno\.(?:com|ai)\/song\/([a-f0-9-]{36})/i);
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

  const audioUrl = `https://cdn1.suno.ai/${songId}.mp3`;

  // Verify the audio file exists on the CDN
  const headRes = await fetch(audioUrl, { method: "HEAD" });
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
    const pageRes = await fetch(`https://suno.com/song/${songId}`, {
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
