/** Keep identical to the API copy: accepted requests must retain their model. */
export const KLING4_MODEL = "kling-video-v4";
export function kling4Available(): boolean {
  return process.env.KLING4_VERIFIED === "true" && !!process.env.PIXAZO_API_KEY;
}
export function kling4Plan(targetSeconds: number) {
  if (!Number.isFinite(targetSeconds) || targetSeconds < 3 || targetSeconds > 600) {
    throw new Error("Kling 4.0 requires a video length from 3 to 600 seconds.");
  }
  const numClips = Math.ceil(targetSeconds / 30);
  const clipDurationSec = Math.max(3, Math.ceil(targetSeconds / numClips));
  return { numClips, clipDurationSec };
}
export function kling4Cost(targetSeconds: number, resolution?: string | null, markup = true): number {
  if (resolution && !["720p", "1080p"].includes(resolution)) throw new Error("Kling 4.0 supports 720p and 1080p only.");
  const { numClips, clipDurationSec } = kling4Plan(targetSeconds);
  const rate = resolution === "1080p" ? 0.235 : 0.157;
  return Math.ceil(numClips * clipDurationSec * rate * (markup ? (numClips === 1 ? 2 : 1.75) : 1) / 0.015 - 1e-9);
}
export function buildKling4Request(req: {
  prompt: string; durationSeconds: number; resolution?: string | null;
  aspectRatio?: string; imageUrl?: string; endImageUrl?: string;
}) {
  if (!Number.isInteger(req.durationSeconds) || req.durationSeconds < 3 || req.durationSeconds > 30) throw new Error("Kling 4.0 shots must be whole seconds from 3 to 30.");
  const resolution = req.resolution ?? "720p";
  if (!["720p", "1080p"].includes(resolution)) throw new Error("Kling 4.0 supports 720p and 1080p only.");
  if (req.endImageUrl && !req.imageUrl) throw new Error("An ending frame requires a starting frame.");
  const aspect = req.aspectRatio ?? "16:9";
  if (!req.imageUrl && !["16:9", "9:16", "1:1", "21:9"].includes(aspect)) throw new Error("Unsupported Kling 4.0 aspect ratio.");
  return {
    endpoint: `https://gateway.pixazo.ai/${KLING4_MODEL}/v1/${req.imageUrl ? "image-to-video" : "text-to-video"}`,
    body: {
      prompt: req.prompt, duration: req.durationSeconds, resolution,
      ...(req.imageUrl ? { start_image_url: req.imageUrl, ...(req.endImageUrl ? { end_image_url: req.endImageUrl } : {}) } : { aspect_ratio: aspect }),
    },
  };
}
