import { Router } from "express";
import { randomUUID } from "crypto";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { analyzeAudioBuffer } from "../lib/audioAnalysis.js";
import { resolveSunoUrl } from "../lib/sunoResolver.js";
import { signAudioAnalysisReceipt } from "../lib/audioAnalysisReceipt.js";
import { and, eq, isNull } from "drizzle-orm";
import { db, soundtracksTable } from "@workspace/db";

const router = Router();
const storageService = new ObjectStorageService();

// Import audio from a Suno (fully supported) or YouTube link into object
// storage so it can be used like an uploaded track — powers "Add from link"
// in the Remix Lab. Returns { objectPath, url, title } on success.
router.post("/audio/import-from-link", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rawUrl = String((req.body as Record<string, unknown>)?.url ?? "").trim();
  if (!rawUrl) {
    res.status(400).json({ error: "A Suno or YouTube link is required." });
    return;
  }

  const isSuno = /suno\.(?:com|ai)\/song\//i.test(rawUrl);
  const isYouTube = /(?:youtube\.com\/watch|youtu\.be\/|music\.youtube\.com)/i.test(rawUrl);
  // A direct audio file link (e.g. a track generated on Digital Drift, or any
  // hosted mp3/wav). Lets partner sites hand a song straight into the editor.
  const isDirectAudio = /^https?:\/\/.+\.(?:mp3|wav|m4a|ogg|aac|flac)(?:\?.*)?$/i.test(rawUrl);

  try {
    let audioUrl: string;
    let title = String((req.body as Record<string, unknown>)?.title ?? "").trim() || "Imported track";

    if (isSuno) {
      const track = await resolveSunoUrl(rawUrl);
      audioUrl = track.audioUrl;
      title = track.title || title;
    } else if (isDirectAudio) {
      audioUrl = rawUrl;
    } else if (isYouTube) {
      // Server-side YouTube audio extraction requires a dedicated downloader
      // (yt-dlp) that isn't available in this environment, and is subject to
      // YouTube's Terms of Service. Fail clearly rather than silently.
      res.status(422).json({
        error: "YouTube import isn't available yet. For now, download the audio and upload it, or paste a Suno link.",
        code: "YOUTUBE_UNAVAILABLE",
      });
      return;
    } else {
      res.status(400).json({ error: "Paste a Suno song link (suno.com/song/…) or a direct audio file link (.mp3/.wav)." });
      return;
    }

    // Download the resolved audio and store it.
    const dl = await fetch(audioUrl, { headers: { "User-Agent": "AIBeatSync/1.0" } });
    if (!dl.ok) {
      res.status(422).json({ error: `Could not fetch the track (status ${dl.status}). Make sure it's public.` });
      return;
    }
    const buffer = Buffer.from(await dl.arrayBuffer());
    const songId = randomUUID();
    const objectPath = await storageService.uploadAudioBuffer(buffer, songId, "mp3", req.user.id);
    const signedUrl = await storageService.getObjectEntitySignedUrl(objectPath, 3600);

    res.json({ objectPath, url: signedUrl, title });
  } catch (err) {
    req.log.warn({ err, url: rawUrl }, "Audio import failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "Could not import audio from link" });
  }
});

router.post("/audio/analyze", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const objectPath: unknown = (req.body as Record<string, unknown>)?.objectPath;
  if (typeof objectPath !== "string" || !objectPath.trim()) {
    res.status(400).json({ error: "objectPath is required" });
    return;
  }

  const userUploadPrefix = `/objects/uploads/${req.user.id}/`;
  const userAudioPrefix = `/objects/audio/${req.user.id}/`;
  const ownerScoped =
    objectPath.startsWith(userUploadPrefix)
    || objectPath.startsWith(userAudioPrefix);
  if (!ownerScoped) {
    const [ownedTrack] = await db
      .select({ id: soundtracksTable.id })
      .from(soundtracksTable)
      .where(and(
        eq(soundtracksTable.userId, req.user.id),
        eq(soundtracksTable.objectPath, objectPath),
        isNull(soundtracksTable.deletedAt),
      ))
      .limit(1);
    if (!ownedTrack) {
      res.status(404).json({ error: "Audio file not found" });
      return;
    }
  }

  let file;
  try {
    file = await storageService.getObjectEntityFile(objectPath);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Audio file not found" });
      return;
    }
    throw err;
  }

  let buf: Buffer;
  try {
    buf = await storageService.downloadObjectBuffer(objectPath);
  } catch {
    res.status(422).json({ error: "Could not download audio file" });
    return;
  }

  const filename = objectPath.split("/").pop() ?? "";
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx !== -1 ? filename.slice(dotIdx + 1).toLowerCase() : "mp3";

  let analysis;
  try {
    analysis = await analyzeAudioBuffer(buf, ext);
  } catch {
    res.status(422).json({ error: "Could not decode or analyse audio file" });
    return;
  }

  const analysisReceipt = signAudioAnalysisReceipt({
    userId: req.user.id,
    objectPath,
    analysis,
  });
  res.json({ ...analysis, analysisReceipt });
});

export default router;
