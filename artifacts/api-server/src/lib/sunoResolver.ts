/**
 * Resolves a Suno share URL to a direct audio CDN URL + metadata.
 * Parses the __NEXT_DATA__ blob embedded in the share page HTML.
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

export async function resolveSunoUrl(url: string): Promise<SunoTrack> {
  const songId = extractSunoId(url);
  if (!songId) throw new Error("Not a valid Suno share URL");

  const pageRes = await fetch(`https://suno.com/song/${songId}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!pageRes.ok) {
    throw new Error(`Suno page returned ${pageRes.status}`);
  }

  const html = await pageRes.text();

  // Primary: __NEXT_DATA__ JSON blob
  const nextMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (nextMatch?.[1]) {
    const nextData = JSON.parse(nextMatch[1]) as Record<string, unknown>;
    const pageProps = (nextData as Record<string, Record<string, unknown>>)
      ?.props?.pageProps as Record<string, unknown> | undefined;

    // Shape A: pageProps.initialData.clips[]
    const clips = (
      pageProps?.initialData as Record<string, unknown> | undefined
    )?.clips as Array<Record<string, unknown>> | undefined;
    const clip = clips?.[0] ?? (pageProps?.clip as Record<string, unknown> | undefined);

    if (clip?.audio_url) {
      return {
        audioUrl: clip.audio_url as string,
        title: (clip.title as string | undefined) ?? "Untitled",
        artist: (clip.display_name as string | undefined) ?? "Unknown",
      };
    }
  }

  // Fallback: og:audio meta tag
  const ogAudio = html.match(/<meta[^>]+property="og:audio"[^>]+content="([^"]+)"/);
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
  if (ogAudio?.[1]) {
    return {
      audioUrl: ogAudio[1],
      title: ogTitle?.[1] ?? "Untitled",
      artist: "Unknown",
    };
  }

  throw new Error("Could not extract audio URL from Suno page");
}
