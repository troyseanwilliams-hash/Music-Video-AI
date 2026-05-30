import { Router } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { analyzeAudioBuffer } from "../lib/audioAnalysis.js";

const router = Router();
const storageService = new ObjectStorageService();

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
    [buf] = await file.download();
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

  res.json(analysis);
});

export default router;
