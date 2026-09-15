/**
 * The small amount of state that may travel between pricing and the auth
 * screens.  Keep this module deliberately independent from React so that
 * redirect handling can be tested without a browser and, more importantly,
 * so that every auth entry point applies the same open-redirect checks.
 */

export const AUTH_DEFAULT_DESTINATION = "/dashboard";
export const AUTH_REGISTER_DEFAULT_DESTINATION = "/generate";
export const AUTH_PRICING_DESTINATION = "/pricing";

export const AUTH_PLAN_NAMES = ["starter", "pro", "studio"] as const;
export type AuthPlan = (typeof AUTH_PLAN_NAMES)[number];
export type AuthBillingInterval = "month" | "year";

export interface AuthIntent {
  returnTo: string;
  plan: AuthPlan | null;
  interval: AuthBillingInterval | null;
  topupId: string | null;
  referralCode: string | null;
  continueCheckout: boolean;
}

export interface AuthUrlOptions {
  returnTo?: unknown;
  plan?: unknown;
  interval?: unknown;
  topupId?: unknown;
  /** Short alias accepted for query/caller compatibility. */
  topup?: unknown;
  /** `priceId` remains accepted for callers that name the catalog value directly. */
  priceId?: unknown;
  referralCode?: unknown;
  continueCheckout?: boolean;
}

const AUTH_ROUTES = new Set([
  "/",
  "/generate",
  "/editor",
  "/dashboard",
  "/gallery",
  "/soundtracks",
  "/prompt-studio",
  "/lyric-sync",
  "/explore",
  "/pricing",
  "/redeem",
  "/admin",
  "/admin/runway-lipsync",
  "/terms",
  "/dmca",
  "/privacy",
  "/support",
  "/settings",
  "/suite",
  "/compare",
  "/podcast",
  "/suno",
  "/spotify-canvas",
  "/ai-music-video-generator",
  "/ai-lyric-video",
  "/instrumental-generator",
  "/suno-to-video",
  "/tutorial/script-to-video",
  "/podcast-to-video",
  "/hip-hop-music-video-generator",
  "/edm-music-video-generator",
  "/rock-music-video-generator",
  "/pop-music-video-generator",
  "/country-music-video-generator",
  "/lofi-music-video-generator",
  "/slideshow-maker",
  "/wedding-slideshow-maker",
  "/capcut-alternative",
]);

const DYNAMIC_AUTH_ROUTES = [
  /^\/s\/[^/]+$/,
  /^\/image\/[^/]+$/,
  /^\/jobs\/[^/]+$/,
  /^\/podcast\/[^/]+$/,
];

const REFERRAL_CODE_PATTERN = /^[A-Z0-9_-]{1,32}$/;
const TOPUP_IDENTIFIER_PATTERN = /^(?:topup|price)_[A-Za-z0-9_-]{1,80}$/;
const ENCODED_PATH_SEPARATOR_PATTERN = /%(?:2f|5c|25)/i;

function isControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isAllowedRoute(pathname: string): boolean {
  return (
    AUTH_ROUTES.has(pathname) ||
    DYNAMIC_AUTH_ROUTES.some((pattern) => pattern.test(pathname))
  );
}

/**
 * Validate a destination that has already been decoded by URLSearchParams.
 *
 * We intentionally do not call decodeURIComponent here.  Decoding a second
 * time is how `%252F%252Fevil.example` turns into an open redirect.  Encoded
 * separators (and encoded percent signs) in the path are rejected instead.
 */
export function safeInternalDestination(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  if (
    value.trim() !== value ||
    isControlCharacter(value) ||
    value.includes("\\") ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return null;
  }

  const pathEnd = value.search(/[?#]/);
  const pathPart = pathEnd === -1 ? value : value.slice(0, pathEnd);
  const queryAndHashPart = pathEnd === -1 ? "" : value.slice(pathEnd);
  if (
    ENCODED_PATH_SEPARATOR_PATTERN.test(pathPart) ||
    ENCODED_PATH_SEPARATOR_PATTERN.test(queryAndHashPart)
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, "https://aibeatsync.com");
  } catch {
    return null;
  }

  if (
    parsed.origin !== "https://aibeatsync.com" ||
    parsed.username ||
    parsed.password ||
    !isAllowedRoute(parsed.pathname)
  ) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function normalizeAuthPlan(value: unknown): AuthPlan | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (AUTH_PLAN_NAMES as readonly string[]).includes(normalized)
    ? (normalized as AuthPlan)
    : null;
}

export function normalizeAuthInterval(
  value: unknown,
): AuthBillingInterval | null {
  return value === "month" || value === "year" ? value : null;
}

/**
 * Top-up identifiers are opaque catalog values, not display names. Keep the
 * accepted shape narrow before it travels through nested auth query params;
 * pricing still resolves the value against the current server catalog before
 * showing a checkout action.
 */
export function normalizeTopupIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return TOPUP_IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(normalized) ? normalized : null;
}

function asSearchParams(value?: string | URLSearchParams): URLSearchParams {
  if (value instanceof URLSearchParams) return new URLSearchParams(value);
  if (!value) {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }
  if (value.startsWith("/")) {
    try {
      return new URL(value, "https://aibeatsync.com").searchParams;
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(value.startsWith("?") ? value.slice(1) : value);
}

/**
 * Return only a destination the caller actually supplied. Auth pages use
 * this when linking to one another so a page's own default (register →
 * generate, login → dashboard) is not accidentally serialized as an explicit
 * cross-link destination.
 */
export function getExplicitAuthDestination(
  value?: string | URLSearchParams,
): string | null {
  const params = asSearchParams(value);
  return safeInternalDestination(params.get("returnTo") ?? params.get("from"));
}

export function getAuthCrossLinkDestination(
  value: string | URLSearchParams | undefined,
  intent: Pick<AuthIntent, "returnTo" | "plan" | "topupId">,
): string | undefined {
  const explicitDestination = getExplicitAuthDestination(value);
  if (explicitDestination) return explicitDestination;
  return intent.plan || intent.topupId ? intent.returnTo : undefined;
}

function pricingDestination(
  plan: AuthPlan | null,
  interval: AuthBillingInterval | null,
  continueCheckout: boolean,
  topupId: string | null = null,
): string {
  const params = new URLSearchParams();
  if (plan) params.set("plan", plan);
  if (interval) params.set("interval", interval);
  if (topupId) params.set("topup", topupId);
  if (continueCheckout || Boolean(topupId)) params.set("continue", "1");
  const query = params.toString();
  return query ? `${AUTH_PRICING_DESTINATION}?${query}` : AUTH_PRICING_DESTINATION;
}

function mergePricingIntent(
  destination: string,
  plan: AuthPlan | null,
  interval: AuthBillingInterval | null,
  continueCheckout: boolean,
  topupId: string | null = null,
): string {
  const parsed = new URL(destination, "https://aibeatsync.com");
  if (parsed.pathname !== AUTH_PRICING_DESTINATION) return destination;
  const params = new URLSearchParams(parsed.search);
  if (plan) params.set("plan", plan);
  if (interval) params.set("interval", interval);
  if (topupId) params.set("topup", topupId);
  if (continueCheckout || Boolean(topupId)) params.set("continue", "1");
  const query = params.toString();
  return `${parsed.pathname}${query ? `?${query}` : ""}${parsed.hash}`;
}

/**
 * Read auth state from either a query string or a full internal location.
 * `returnTo` is the canonical key; `from` remains supported for existing
 * routes that already send users to login with that key.
 */
export function getAuthIntent(
  value?: string | URLSearchParams,
  defaultDestination?: string,
): AuthIntent {
  const params = asSearchParams(value);
  const requestedDestination = params.get("returnTo") ?? params.get("from");
  const requestedPlan = normalizeAuthPlan(params.get("plan"));
  const requestedInterval = normalizeAuthInterval(params.get("interval"));
  const requestedTopup = normalizeTopupIdentifier(
    params.get("topup") ?? params.get("priceId") ?? params.get("price"),
  );
  const referralCode = normalizeReferralCode(
    params.get("ref") ?? params.get("referralCode"),
  );

  let inferredDefault = AUTH_DEFAULT_DESTINATION;
  if (typeof value === "string" && value.startsWith("/")) {
    try {
      const pathname = new URL(value, "https://aibeatsync.com").pathname;
      if (pathname === "/register") {
        inferredDefault = AUTH_REGISTER_DEFAULT_DESTINATION;
      }
    } catch {
      // The explicit safe destination below remains the fallback.
    }
  }
  const fallbackDestination =
    safeInternalDestination(defaultDestination ?? inferredDefault) ??
    AUTH_DEFAULT_DESTINATION;
  let returnTo = safeInternalDestination(requestedDestination);
  let plan = requestedPlan;
  let interval = requestedInterval;
  let topupId = requestedTopup;
  let continueCheckout = params.get("continue") === "1";

  if (returnTo) {
    try {
      const parsed = new URL(returnTo, "https://aibeatsync.com");
      if (parsed.pathname === AUTH_PRICING_DESTINATION) {
        const pricingParams = parsed.searchParams;
        plan ??= normalizeAuthPlan(pricingParams.get("plan"));
        interval ??= normalizeAuthInterval(pricingParams.get("interval"));
        topupId ??= normalizeTopupIdentifier(
          pricingParams.get("topup") ??
            pricingParams.get("priceId") ??
            pricingParams.get("price"),
        );
        continueCheckout ||= pricingParams.get("continue") === "1";
      }
    } catch {
      // safeInternalDestination already validated this; use the fallback
      // below if URL parsing ever behaves differently in another runtime.
      returnTo = null;
    }
  }

  if (!returnTo) {
    returnTo =
      plan || topupId
        ? pricingDestination(plan, interval, true, topupId)
        : fallbackDestination;
    continueCheckout = Boolean(plan || topupId);
  } else if (plan || interval || topupId) {
    try {
      const parsed = new URL(returnTo, "https://aibeatsync.com");
      if (parsed.pathname === AUTH_PRICING_DESTINATION) {
        // A selected plan always needs an explicit checkout step after auth,
        // even when a caller supplied only `returnTo=/pricing`.
        if (plan || topupId) continueCheckout = true;
        returnTo = mergePricingIntent(
          returnTo,
          plan,
          interval,
          continueCheckout || Boolean(plan || topupId),
          topupId,
        );
      }
    } catch {
      // Already validated above; retain the safe fallback if this runtime
      // cannot parse the URL a second time.
    }
  }

  return {
    returnTo,
    plan,
    interval,
    topupId,
    referralCode,
    continueCheckout,
  };
}

/**
 * Build links between auth screens without ever placing an unvalidated
 * destination in the URL.  URLSearchParams performs exactly one layer of
 * encoding for the nested return destination.
 */
export function buildAuthUrl(
  route: "/login" | "/register",
  options: AuthUrlOptions = {},
): string {
  const plan = normalizeAuthPlan(options.plan);
  const interval = normalizeAuthInterval(options.interval);
  const topupId = normalizeTopupIdentifier(
    options.topupId ?? options.topup ?? options.priceId,
  );
  const referralCode = normalizeReferralCode(options.referralCode);
  const continueCheckout = options.continueCheckout === true;
  const routeDefaultDestination =
    route === "/register"
      ? AUTH_REGISTER_DEFAULT_DESTINATION
      : AUTH_DEFAULT_DESTINATION;
  const requestedDestination = safeInternalDestination(options.returnTo);
  const destination =
    requestedDestination ??
    (plan || topupId
      ? pricingDestination(plan, interval, true, topupId)
      : routeDefaultDestination);
  const returnTo = mergePricingIntent(
    destination,
    plan,
    interval,
    continueCheckout,
    topupId,
  );

  const params = new URLSearchParams();
  if (returnTo !== routeDefaultDestination) {
    params.set("returnTo", returnTo);
  }
  if (plan) params.set("plan", plan);
  if (interval) params.set("interval", interval);
  if (topupId) params.set("topup", topupId);
  if (referralCode) params.set("ref", referralCode);
  if (continueCheckout) params.set("continue", "1");
  const query = params.toString();
  return query ? `${route}?${query}` : route;
}

export function buildPricingIntent(
  plan: unknown,
  interval: unknown,
  continueCheckout = true,
  topupId?: unknown,
): string {
  return pricingDestination(
    normalizeAuthPlan(plan),
    normalizeAuthInterval(interval),
    continueCheckout,
    normalizeTopupIdentifier(topupId),
  );
}