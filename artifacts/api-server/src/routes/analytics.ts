// Public analytics ingest. The frontend batches pageviews, time-on-page, and
// named funnel events and POSTs them here (often via navigator.sendBeacon on
// page hide). We never fail the client — analytics must never break browsing —
// so every error is swallowed and we always answer 204.

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, analyticsEventsTable } from "@workspace/db";
import { isClientSubmittedSignupEvent } from "../lib/signupAnalytics.js";

const router = Router();

// Keep the log tidy and cheap: cap batch size and string lengths.
const MAX_EVENTS = 50;
const clip = (v: unknown, max = 512): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const safeEventType = (value: unknown): string | null => {
  const type = clip(value, 49);
  return type && /^[a-z][a-z0-9_]{0,48}$/.test(type) ? type : null;
};
const safeAnonId = (value: unknown): string | null => {
  const id = clip(value, 64);
  return id && /^[a-zA-Z0-9-]{1,64}$/.test(id) ? id : null;
};
const safePath = (value: unknown): string | null => {
  const path = clip(value, 256);
  if (!path || !path.startsWith("/")) return null;
  return path.split(/[?#]/, 1)[0] ?? null;
};
const safeDimension = (value: unknown): string | null => {
  const dimension = clip(value, 64);
  return dimension && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(dimension)
    ? dimension
    : null;
};
const safeReferrerDomain = (value: unknown): string | null => {
  const referrer = clip(value, 512);
  if (!referrer) return null;
  if (/^[a-z0-9.-]{1,253}$/i.test(referrer)) return referrer.toLowerCase();
  try {
    const parsed = new URL(referrer);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.hostname.toLowerCase().slice(0, 253)
      : null;
  } catch {
    return null;
  }
};
const safeMeta = (value: unknown): Record<string, string | number | boolean> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (!/^[a-z][a-z0-9_]{0,48}$/.test(key)) continue;
    if (typeof item === "string") {
      result[key] = item.slice(0, 128);
    } else if (typeof item === "boolean") {
      result[key] = item;
    } else if (typeof item === "number" && Number.isFinite(item)) {
      result[key] = item;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
};

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

    const rows = events.flatMap((e) => {
      const eventType = safeEventType(e.type);
      // Account creation is emitted by /auth/register in the same database
      // transaction as the new user. Never trust a browser event for this
      // signup outcome names, including from an authenticated browser.
      if (!eventType || isClientSubmittedSignupEvent(eventType)) return [];
      return [{
        id: randomUUID(),
        anonId: safeAnonId(e.anonId),
        userId,
        eventType,
        path: safePath(e.path),
        // Store attribution dimensions, never full URLs or query strings.
        referrer: safeReferrerDomain(e.referrer) ?? safeReferrerDomain(req.get("referer")),
        utmSource: safeDimension(e.utmSource),
        utmMedium: safeDimension(e.utmMedium),
        utmCampaign: safeDimension(e.utmCampaign),
        durationMs:
          typeof e.durationMs === "number" && Number.isFinite(e.durationMs) && e.durationMs >= 0
            ? Math.min(Math.round(e.durationMs), 6 * 60 * 60 * 1000) // clamp to 6h
            : null,
        meta: safeMeta(e.meta),
      }];
    });

    if (rows.length > 0) {
      await db.insert(analyticsEventsTable).values(rows);
    }
  } catch (err) {
    req.log?.warn({ err }, "analytics ingest failed (ignored)");
  }
  res.status(204).end();
});

export default router;
