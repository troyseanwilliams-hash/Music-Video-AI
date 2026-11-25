import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Hosts allowed to send credentialed (cookie) requests to the API: the host
 * the request was addressed to, the configured app URL (plus its apex/www
 * twin), Replit domains, and anything listed in CORS_ALLOWED_ORIGINS
 * (comma-separated hosts or URLs).
 */
export function allowedOriginHosts(
  requestHost: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const hosts = new Set<string>();
  const add = (v: string | undefined) => {
    const h = v ? hostOf(v.trim()) : null;
    if (h) hosts.add(h);
  };
  add(requestHost);
  add(env.REPLIT_DEV_DOMAIN);
  for (const d of (env.REPLIT_DOMAINS ?? "").split(",")) add(d);
  for (const d of (env.CORS_ALLOWED_ORIGINS ?? "").split(",")) add(d);
  const appHost = env.APP_URL ? hostOf(env.APP_URL) : null;
  if (appHost) {
    hosts.add(appHost);
    hosts.add(appHost.startsWith("www.") ? appHost.slice(4) : `www.${appHost}`);
  }
  return hosts;
}

/**
 * A request without an Origin header is not a cross-site browser request
 * (browsers attach Origin to cross-origin fetches and to all non-GET requests),
 * so it is allowed. Otherwise the origin must be on the allowlist.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  requestHost: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes the literal "null" origin
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (env.NODE_ENV !== "production" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return true;
  }
  return allowedOriginHosts(requestHost, env).has(url.host.toLowerCase());
}

/** Blocks state-changing requests that a foreign website made with the user's cookies. */
export function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }
  if (isAllowedOrigin(req.get("origin"), req.get("host"))) {
    next();
    return;
  }
  res.status(403).json({
    error: "This request came from an untrusted website.",
    code: "CSRF_ORIGIN",
  });
}
