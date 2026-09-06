export type PodcastHighlight = {
  id: string;
  title: string;
  description: string;
  startSeconds?: number;
  endSeconds?: number;
  path?: string;
};

export function formatMediaDuration(seconds?: number | null): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Turns an owner-scoped object path into the authenticated storage route. */
export function podcastMediaUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("/api/storage/")) return path;
  if (path.startsWith("/objects/")) return `/api/storage${path}`;
  return path;
}

export function normalizePodcastHighlights(value: unknown): PodcastHighlight[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((item, index) => {
    if (typeof item === "string") {
      return { id: String(index), title: `Highlight ${index + 1}`, description: item };
    }
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const startSeconds = typeof record.startSeconds === "number" ? record.startSeconds
      : typeof record.startTime === "number" ? record.startTime : undefined;
    const endSeconds = typeof record.endSeconds === "number" ? record.endSeconds
      : startSeconds !== undefined && typeof record.durationSeconds === "number"
        ? startSeconds + record.durationSeconds : undefined;
    return {
      id: typeof record.id === "string" ? record.id : String(index),
      title: typeof record.title === "string" && record.title.trim()
        ? record.title : `Highlight ${index + 1}`,
      description: typeof record.description === "string" ? record.description
        : typeof record.summary === "string" ? record.summary : "",
      startSeconds,
      endSeconds,
      path: typeof record.path === "string" ? record.path
        : typeof record.clipPath === "string" ? record.clipPath : undefined,
    };
  });
}