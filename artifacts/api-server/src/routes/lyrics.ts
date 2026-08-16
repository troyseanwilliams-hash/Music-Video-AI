import { Router } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { alignLyrics, lyricAlignAvailable } from "../lib/lyricAlign.js";

const router = Router();
const storageService = new ObjectStorageService();

/**
 * POST /lyrics/align
 * Transcribe / align a loaded song into enhanced LRC for karaoke.
 * Body: { audioObjectPath: string, lyricsText?: string }
 * Returns: { lrc, confidence, source, wordCount, lowConfidence }
 */
router.post("/lyrics/align", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!lyricAlignAvailable()) {
    res.status(503).json({
      error: "Lyric alignment isn't configured (missing ASSEMBLYAI_API_KEY).",
      code: "ALIGN_UNAVAILABLE",
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const audioObjectPath = typeof body.audioObjectPath === "string" ? body.audioObjectPath.trim() : "";
  const lyricsText = typeof body.lyricsText === "string" ? body.lyricsText : null;
  if (!audioObjectPath) {
    res.status(400).json({ error: "audioObjectPath is required" });
    return;
  }

  let audioUrl: string;
  try {
    audioUrl = await storageService.getObjectEntitySignedUrl(audioObjectPath, 3600);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Audio file not found" });
      return;
    }
    throw err;
  }

  try {
    const result = await alignLyrics({ audioUrl, lyricsText });
    res.json(result);
  } catch (err) {
    req.log.warn({ err, audioObjectPath }, "Lyric alignment failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "Lyric alignment failed" });
  }
});

export default router;
