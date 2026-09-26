const SUNO_HOSTS = new Set(["suno.com", "www.suno.com", "suno.ai", "www.suno.ai"]);

export function isSunoShareUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    const authority = /^https:\/\/([^/?#]+)/i.exec(raw.trim())?.[1] ?? "";
    return url.protocol === "https:" &&
      !url.username && !url.password && !url.port && !authority.includes(":") &&
      SUNO_HOSTS.has(url.hostname.toLowerCase()) &&
      (/^\/song\/[a-f0-9-]{36}\/?$/i.test(url.pathname) ||
        /^\/s\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname));
  } catch {
    return false;
  }
}

export const SUNO_LINK_ERROR = "Paste a valid HTTPS Suno song or short share link.";

export interface ImportedSunoTrack {
  objectPath: string;
  url: string;
  title: string;
}

export async function importSunoTrack(url: string, signal?: AbortSignal): Promise<ImportedSunoTrack> {
  if (!isSunoShareUrl(url)) throw new Error(SUNO_LINK_ERROR);
  const response = await fetch("/api/audio/import-from-link", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim() }),
    signal,
  });
  const data = await response.json() as Partial<ImportedSunoTrack> & { error?: string };
  if (!response.ok) throw new Error(data.error || "Could not import the track. Please try again.");
  if (!data.objectPath || !data.url) throw new Error("Import did not return a usable track. Please try again.");
  return { objectPath: data.objectPath, url: data.url, title: data.title || "Imported track" };
}