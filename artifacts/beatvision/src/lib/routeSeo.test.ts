// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyRouteSeo, publicRouteSeo, renderRouteHtml, seoForPath } from "./routeSeo";

describe("route SEO", () => {
  it("updates the same tags across client-side navigation and back without duplicates", () => {
    document.head.innerHTML = '<title>Initial</title><meta name="description" content="Old"><link rel="canonical" href="https://aibeatsync.com/">';
    for (const route of ["/", "/images", "/soundtracks", "/gallery", "/login", "/register", "/pricing", "/generate", "/"]) {
      const seo = seoForPath(route);
      applyRouteSeo(seo);
      expect(document.title).toBe(seo.title);
      expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(seo.description);
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`https://aibeatsync.com${seo.path}`);
      expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(seo.title);
      expect(document.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe("https://aibeatsync.com/opengraph.jpg");
      expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toContain(seo.noindex ? "noindex" : "index, follow");
      expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
      expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
      expect(document.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    }
    expect(seoForPath("/jobs/abc").noindex).toBe(true);
    expect(seoForPath("/image/123").noindex).toBe(true);
    expect(seoForPath("/admin/runway-lipsync").noindex).toBe(true);
    expect(seoForPath("/signup").path).toBe("/register");
  });

  it("renders route-specific source HTML before client scripts execute", () => {
    const shell = `<head><title>Home</title><meta name="description" content="Home"><meta name="robots" content="index"><link rel="canonical" href="https://aibeatsync.com/"><meta property="og:url" content="https://aibeatsync.com/"><meta property="og:title" content="Home"><meta property="og:description" content="Home"><meta name="twitter:title" content="Home"><meta name="twitter:description" content="Home"></head>`;
    for (const route of Object.keys(publicRouteSeo)) {
      const seo = publicRouteSeo[route];
      const html = renderRouteHtml(shell, seo);
      const parsed = new DOMParser().parseFromString(html, "text/html");
      expect(parsed.title).toBe(seo.title);
      expect(parsed.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`https://aibeatsync.com${seo.path}`);
      expect(parsed.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(seo.title);
      expect(html).toContain(seo.noindex ? "noindex, nofollow" : "index, follow");
    }
  });
});