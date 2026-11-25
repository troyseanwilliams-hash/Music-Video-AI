import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { allowedOriginHosts, csrfOriginGuard, isAllowedOrigin } from "./originPolicy.js";

const prodEnv = {
  NODE_ENV: "production",
  APP_URL: "https://aibeatsync.com",
  REPLIT_DOMAINS: "beat.example.replit.app,other.example.replit.app",
} as NodeJS.ProcessEnv;

describe("allowedOriginHosts", () => {
  it("includes the request host, app URL with its www twin, and Replit domains", () => {
    const hosts = allowedOriginHosts("aibeatsync.com", prodEnv);
    expect(hosts.has("aibeatsync.com")).toBe(true);
    expect(hosts.has("www.aibeatsync.com")).toBe(true);
    expect(hosts.has("beat.example.replit.app")).toBe(true);
    expect(hosts.has("other.example.replit.app")).toBe(true);
  });

  it("adds CORS_ALLOWED_ORIGINS entries given as hosts or URLs", () => {
    const hosts = allowedOriginHosts("aibeatsync.com", {
      ...prodEnv,
      CORS_ALLOWED_ORIGINS: "partner.example.com, https://app.partner.io",
    });
    expect(hosts.has("partner.example.com")).toBe(true);
    expect(hosts.has("app.partner.io")).toBe(true);
  });
});

describe("isAllowedOrigin", () => {
  it("allows requests with no Origin header (not a cross-site browser request)", () => {
    expect(isAllowedOrigin(undefined, "aibeatsync.com", prodEnv)).toBe(true);
  });

  it("allows our own origins", () => {
    expect(isAllowedOrigin("https://aibeatsync.com", "aibeatsync.com", prodEnv)).toBe(true);
    expect(isAllowedOrigin("https://www.aibeatsync.com", "aibeatsync.com", prodEnv)).toBe(true);
    expect(isAllowedOrigin("https://beat.example.replit.app", "x.internal", prodEnv)).toBe(true);
  });

  it("rejects foreign, look-alike, null and non-http origins", () => {
    expect(isAllowedOrigin("https://evil.example", "aibeatsync.com", prodEnv)).toBe(false);
    expect(isAllowedOrigin("https://aibeatsync.com.evil.example", "aibeatsync.com", prodEnv)).toBe(false);
    expect(isAllowedOrigin("https://evilaibeatsync.com", "aibeatsync.com", prodEnv)).toBe(false);
    expect(isAllowedOrigin("null", "aibeatsync.com", prodEnv)).toBe(false);
    expect(isAllowedOrigin("not a url", "aibeatsync.com", prodEnv)).toBe(false);
    expect(isAllowedOrigin("chrome-extension://abc", "aibeatsync.com", prodEnv)).toBe(false);
  });

  it("allows localhost only outside production", () => {
    expect(isAllowedOrigin("http://localhost:5173", "x", { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173", "x", prodEnv)).toBe(false);
  });
});

function run(method: string, origin: string | undefined, host = "aibeatsync.com") {
  const prev = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://aibeatsync.com" });
  try {
    const req = {
      method,
      get: (h: string) => ({ origin, host }[h.toLowerCase() as "origin" | "host"]),
    } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    csrfOriginGuard(req, res, next);
    return { next, status, json };
  } finally {
    process.env = prev;
  }
}

describe("csrfOriginGuard", () => {
  it("lets safe methods through regardless of origin", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const r = run(method, "https://evil.example");
      expect(r.next).toHaveBeenCalledOnce();
      expect(r.status).not.toHaveBeenCalled();
    }
  });

  it("blocks state-changing requests from a foreign origin with 403", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      const r = run(method, "https://evil.example");
      expect(r.next).not.toHaveBeenCalled();
      expect(r.status).toHaveBeenCalledWith(403);
      expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: "CSRF_ORIGIN" }));
    }
  });

  it("allows state-changing requests from our own origin and from non-browser clients", () => {
    expect(run("POST", "https://aibeatsync.com").next).toHaveBeenCalledOnce();
    expect(run("POST", undefined).next).toHaveBeenCalledOnce();
  });
});
