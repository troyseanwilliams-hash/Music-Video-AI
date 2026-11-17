export const VIDEO_READ_ERROR = "This browser couldn't read the video. MOV files can contain unsupported codecs such as HEVC or ProRes. Export a copy as MP4 with H.264 video and AAC audio, then try again.";

// Metadata is authoritative; a missing thumbnail must never shorten a clip.
// iOS/data-saving browsers may provide metadata without firing loadeddata.
export function probeVideo(url: string, timeoutMs = 20_000): Promise<{ duration: number; thumb: string | null }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    let duration: number | null = null;
    let settled = false;
    let thumbnailTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => finish(new Error("Timed out reading this video's length. Try an MP4 (H.264) copy.")), timeoutMs);
    function finish(error?: Error, thumb: string | null = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(thumbnailTimer);
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      if (error || duration === null) reject(error ?? new Error(VIDEO_READ_ERROR));
      else resolve({ duration, thumb });
    }
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
        finish(new Error(VIDEO_READ_ERROR));
        return;
      }
      duration = video.duration;
      // Thumbnail decoding is optional and bounded, unlike duration detection.
      thumbnailTimer = setTimeout(() => finish(), 1000);
    };
    video.onloadeddata = () => {
      if (duration === null) return;
      let thumb: string | null = null;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = Math.max(1, Math.round(200 * video.videoHeight / video.videoWidth));
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumb = canvas.toDataURL("image/jpeg", 0.6);
      } catch { /* A thumbnail is optional; the duration is not. */ }
      finish(undefined, thumb);
    };
    video.onerror = () => finish(new Error(VIDEO_READ_ERROR));
    video.src = url;
  });
}
