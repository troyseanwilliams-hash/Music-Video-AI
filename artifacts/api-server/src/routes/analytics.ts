// Public analytics ingest. The frontend batches pageviews, time-on-page, and
// named funnel events and POSTs them here (often via navigator.sendBeacon on
// page hide). We never fail the client — analytics must never break browsing —
// so every error is swallowed and we always answer 204.

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, analyticsEventsTable } from "@workspace/db";

const router = Router();

// Keep the log tidy and cheap: cap batch size and string lengths.
const MAX_EVENTS = 50;
const clip = (v: unknown, max = 512): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

interface IncomingEvent {
  type?: string;
  path?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  durationMs?: number;
  anonId?: string;
  meta?: unknown;
}

router.post("/analytics/collect", async (req, res) => {
  try {
    const body = req.body as { events?: IncomingEvent[] } | undefined;
    const events = Array.isArray(body?.events) ? body!.events!.slice(0, MAX_EVENTS) : [];
    if (events.length === 0) {
      res.status(204).end();
      return;
    }

    const userId = req.isAuthenticated() ? req.user.id : null;

    const rows = events
      .filter((e) => clip(e.type))
      .map((e) => ({
        id: randomUUID(),
        anonId: clip(e.anonId, 64),
        userId,
        eventType: clip(e.type, 64)!,
        path: clip(e.path, 256),
        // Prefer the client-reported (first-touch) referrer; fall back to header.
        referrer: clip(e.referrer, 512) ?? clip(req.get("referer"), 512),
        utmSource: clip(e.utmSource, 128),
        utmMedium: clip(e.utmMedium, 128),
        utmCampaign: clip(e.utmCampaign, 128),
        durationMs:
          typeof e.durationMs === "number" && Number.isFinite(e.durationMs) && e.durationMs >= 0
            ? Math.min(Math.round(e.durationMs), 6 * 60 * 60 * 1000) // clamp to 6h
            : null,
        meta: e.meta && typeof e.meta === "object" ? e.meta : null,
      }));

    if (rows.length > 0) {
      await db.insert(analyticsEventsTable).values(rows);
    }
  } catch (err) {
    req.log?.warn({ err }, "analytics ingest failed (ignored)");
  }
  res.status(204).end();
});

export default router;
