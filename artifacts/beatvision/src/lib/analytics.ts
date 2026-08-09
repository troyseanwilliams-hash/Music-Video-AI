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

interface TrackedEvent {
  type: string;
  path?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  durationMs?: number;
  anonId?: string;
  meta?: Record<string, unknown>;
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

function anonId(): string {
  let id = safeGet(ANON_KEY);
  if (!id) {
    id = (crypto?.randomUUID?.() ?? `a-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    safeSet(ANON_KEY, id);
  }
  return id;
}

// Capture where this visitor came from ONCE (first touch), so later pageviews
// still carry attribution even after the UTM params drop off the URL.
function firstTouch(): FirstTouch {
  const existing = safeGet(FIRST_TOUCH_KEY);
  if (existing) {
    try { return JSON.parse(existing) as FirstTouch; } catch { /* fall through */ }
  }
  const params = new URLSearchParams(window.location.search);
  const ft: FirstTouch = {
    referrer: document.referrer || "",
    utmSource: params.get("utm_source") || "",
    utmMedium: params.get("utm_medium") || "",
    utmCampaign: params.get("utm_campaign") || "",
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

/** Record a named funnel event, e.g. track("checkout_start", { plan }). */
export function track(type: string, meta?: Record<string, unknown>): void {
  enqueue({ type, path: currentPath ?? window.location.pathname, meta });
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
