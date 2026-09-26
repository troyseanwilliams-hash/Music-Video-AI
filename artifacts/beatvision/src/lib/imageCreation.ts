export function analyzeNumberedScenes(script: string, maxScenes: number): {
  count: number | null;
  invalid: boolean;
} {
  const linePattern = /^\s*(?:scene\s+)?(\d{1,2})\s*(?:(?:[.):])\s*|\s+)(?:\(\s*(?:\d+(?:\.\d+)?s?|\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(?:\d+(?:\.\d+)?s?|\d{1,2}:\d{2}(?::\d{2})?)\s*\)\s*[:\-]?\s*)?(.+?)\s*$/i;
  const lines = script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const first = lines.findIndex((line) => line.match(linePattern)?.[1] === "1");
  if (first < 0) return { count: null, invalid: false };
  let expected = 1;
  for (const line of lines.slice(first)) {
    const match = line.match(linePattern);
    if (!match || Number(match[1]) !== expected || !match[2]?.trim()) {
      return { count: null, invalid: true };
    }
    expected++;
  }
  const count = expected - 1;
  return count <= maxScenes ? { count, invalid: false } : { count: null, invalid: true };
}

/** Only legacy image-mode links move; unrelated video query strings stay on Generate Video. */
export function imageCreationRedirect(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!["images", "image", "image-pack"].includes(params.get("mode") ?? "")) return null;
  params.delete("mode");
  const query = params.toString();
  return `/images${query ? `?${query}` : ""}`;
}