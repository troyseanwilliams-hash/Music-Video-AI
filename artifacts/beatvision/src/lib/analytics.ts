// Lightweight first-party analytics client.
//
// Tracks pageviews, time-on-page, and named funnel events, batches them, and
// ships them to /api/analytics/collect — using navigator.sendBeacon on page
// hide so the last (most important) page's time isn't lost. Zero dependencies,
// no cookies; a single anonymous id lives in localStorage so we can follow a
// visitor from first landing through signup. Fails silently by design.

const ANON_KEY = "bv-anon";
const FIRST_TOUCH_KEY = "bv-first-touch";
const ENDPOINT = "/api/analytics/collect";
const FLUSH_MS = 15000;

// Optional attribution context for POST /api/auth/register. This is kept out
// of the registration body so it is not an authentication/API contract field.
export const ANALYTICS_ANON_ID_HEADER = "x-analytics-anon-id";

export type AnalyticsValue = string | number | boolean;
export type AnalyticsData = Record<string, AnalyticsValue>;

/**
 * Privacy-safe product event vocabulary. Values must be low-cardinality
 * dimensions or opaque product identifiers; never pass names, email addresses,
 * prompts, lyrics, filenames, URLs, or other free-form user content.
 *
 * `track` remains available for production event names that predate this
 * vocabulary. New funnel instrumentation should use `trackEvent`.
 */
export interface AnalyticsEventMap {
  signup_started: { has_referral: boolean };
  signup_completed: { has_referral: boolean };
  teaser_cta_clicked: { source: "generate" | "remix"; destination: "register" | "pricing" };
  pricing_viewed: { authenticated: boolean };
  plan_selected: {
    plan: string;
    billing_interval: string;
    purchase_type: "subscription" | "topup";
    authenticated: boolean;
  };
  checkout_returned: { outcome: "success" | "cancelled" };
  creation_started: {
    creation_type: "video" | "image_pack" | "soundtrack" | "podcast";
    has_audio?: boolean;
    has_lyrics?: boolean;
    duration_seconds?: number;
    image_count?: number;
    soundtrack_type?: "instrumental" | "vocals";
  };
  creation_accepted: {
    creation_type: "video" | "image_pack" | "soundtrack" | "podcast";
  };
  creation_completed: {
    creation_type: "video" | "image_pack" | "soundtrack" | "montage" | "podcast";
  };
  export_started: {
    export_type: "montage";
    segment_count: number;
    has_music: boolean;
    has_karaoke: boolean;
  };
  export_accepted: { export_type: "montage" };
  export_completed: { export_type: "montage" };
  export_downloaded: { export_type: "video" | "soundtrack" | "podcast" };
  soundtrack_sent_to_video: { destination: "generate" | "montage" };
  starter_video_step: {
    step: "opened" | "audio_ready" | "visual_ready" | "review" | "storyboard_opened" | "submitted" | "customize";
    entry?: "default" | "dashboard" | "guide";
    audio_choice?: "upload" | "library" | "silent";
    affordable?: boolean;
  };
  first_result_next_step: { next: "starter_video" | "images" | "montage" };
}

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

interface TrackedEvent {
  type: string;
  path?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  durationMs?: number;
  anonId?: string;
  meta?: AnalyticsData;
}

interface FirstTouch {
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
}

let queue: TrackedEvent[] = [];
let currentPath: string | null = null;
let pageEnteredAt = 0;
let started = false;

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, val: string): void {
  try { localStorage.setItem(key, val); } catch { /* private mode */ }
}

export function sanitizeCampaignDimension(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(trimmed) ? trimmed : "";
}

export function sanitizeReferrerDomain(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z0-9.-]{1,253}$/i.test(trimmed)) return trimmed.toLowerCase();
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.hostname.toLowerCase().slice(0, 253)
      : "";
  } catch {
    return "";
  }
}

function anonId(): string {
  let id = safeGet(ANON_KEY)?.trim() ?? null;
  if (!id || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) {
    id = (crypto?.randomUUID?.() ?? `a-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    safeSet(ANON_KEY, id);
  }
  return id;
}

/**
 * Return the bounded opaque visitor id for an auth request. Callers can spread
 * the result into fetch headers without changing the auth request body:
 * `{ ...getAnalyticsAttributionHeaders() }`.
 */
export function getAnalyticsAnonId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return anonId();
}

export function getAnalyticsAttributionHeaders(): Record<string, string> {
  const id = getAnalyticsAnonId();
  return id ? { [ANALYTICS_ANON_ID_HEADER]: id } : {};
}

// Capture where this visitor came from ONCE (first touch), so later pageviews
// still carry attribution even after the UTM params drop off the URL.
function firstTouch(): FirstTouch {
  const existing = safeGet(FIRST_TOUCH_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as Partial<FirstTouch>;
      const sanitized: FirstTouch = {
        referrer: sanitizeReferrerDomain(parsed.referrer),
        utmSource: sanitizeCampaignDimension(parsed.utmSource),
        utmMedium: sanitizeCampaignDimension(parsed.utmMedium),
        utmCampaign: sanitizeCampaignDimension(parsed.utmCampaign),
      };
      safeSet(FIRST_TOUCH_KEY, JSON.stringify(sanitized));
      return sanitized;
    } catch { /* fall through */ }
  }
  const params = new URLSearchParams(window.location.search);
  const ft: FirstTouch = {
    referrer: sanitizeReferrerDomain(document.referrer),
    utmSource: sanitizeCampaignDimension(params.get("utm_source")),
    utmMedium: sanitizeCampaignDimension(params.get("utm_medium")),
    utmCampaign: sanitizeCampaignDimension(params.get("utm_campaign")),
  };
  safeSet(FIRST_TOUCH_KEY, JSON.stringify(ft));
  return ft;
}

function enqueue(ev: TrackedEvent): void {
  const ft = firstTouch();
  queue.push({
    ...ev,
    anonId: anonId(),
    referrer: ev.referrer ?? ft.referrer,
    utmSource: ev.utmSource ?? ft.utmSource,
    utmMedium: ev.utmMedium ?? ft.utmMedium,
    utmCampaign: ev.utmCampaign ?? ft.utmCampaign,
  });
  if (queue.length >= 20) flush();
}

function flush(useBeacon = false): void {
  if (queue.length === 0) return;
  const events = queue;
  queue = [];
  const payload = JSON.stringify({ events });
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
    } else {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: payload,
        keepalive: true,
      }).catch(() => { /* ignore */ });
    }
  } catch { /* ignore */ }
}

// Record how long the visitor spent on the page they're leaving.
function closeCurrentPage(): void {
  if (currentPath && pageEnteredAt) {
    const durationMs = Date.now() - pageEnteredAt;
    // Ignore absurd values (tab left open for days) and sub-second flickers.
    if (durationMs >= 500 && durationMs < 6 * 60 * 60 * 1000) {
      enqueue({ type: "page_time", path: currentPath, durationMs });
    }
  }
}

/** Call on every route change (and once on load). */
export function trackPageview(path: string): void {
  if (path === currentPath) return;
  closeCurrentPage();
  currentPath = path;
  pageEnteredAt = Date.now();
  enqueue({ type: "pageview", path });
}

export function sanitizeAnalyticsData(
  meta?: Record<string, unknown>,
): AnalyticsData | undefined {
  if (!meta) return undefined;
  const data: AnalyticsData = {};
  for (const [key, value] of Object.entries(meta)) {
    if (
      typeof value === "string"
      || typeof value === "number" && Number.isFinite(value)
      || typeof value === "boolean"
    ) {
      data[key] = value;
    }
  }
  return Object.keys(data).length ? data : undefined;
}

function emit(type: string, meta?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  // Keep custom event names compatible with both collectors.
  if (!/^[a-z][a-z0-9_]{0,48}$/.test(type)) return;
  // Signup outcomes are authoritative only when emitted by auth.ts. Keep this
  // guard as defense in depth for stale callers while the collector applies
  // the same rule.
  if (type === "signup_completed" || type === "signup_failed") return;
  const data = sanitizeAnalyticsData(meta);
  enqueue({ type, path: currentPath ?? window.location.pathname, meta: data });
  try {
    window.umami?.track(type, data);
  } catch {
    // Analytics must never affect the product experience.
  }
}

/** Record a legacy named event. Prefer trackEvent for new instrumentation. */
export function track(type: string, meta?: Record<string, unknown>): void {
  emit(type, meta);
}

/** Record a typed, privacy-safe product funnel event. */
export function trackEvent<Name extends keyof AnalyticsEventMap>(
  type: Name,
  ...args: AnalyticsEventMap[Name] extends Record<string, never>
    ? [meta?: AnalyticsEventMap[Name]]
    : [meta: AnalyticsEventMap[Name]]
): void {
  emit(type, args[0]);
}

/** Wire up flush timers + page-hide handlers exactly once. */
export function startAnalytics(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  setInterval(() => flush(), FLUSH_MS);

  // The reliable "leaving" signal on mobile is visibilitychange→hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      closeCurrentPage();
      // Reset the timer so returning to the tab doesn't double-count.
      pageEnteredAt = Date.now();
      flush(true);
    }
  });
  window.addEventListener("pagehide", () => { closeCurrentPage(); flush(true); });
}
