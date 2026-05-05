import { Router } from "express";
import { resolveSunoUrl } from "../lib/sunoResolver.js";

const router = Router();

router.get("/api/suno/resolve", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { url } = req.query;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url query param required" });
    return;
  }

  try {
    const track = await resolveSunoUrl(url);
    res.json(track);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to resolve Suno URL";
    req.log.warn({ err, url }, "Suno resolve failed");
    res.status(502).json({ error: msg });
  }
});

export default router;
