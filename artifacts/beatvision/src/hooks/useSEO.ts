import { useEffect } from "react";
import { publicRouteSeo, seoForPath } from "@/lib/routeSeo";

interface SEOProps {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
  ogType?: "website" | "article";
  ogImage?: string;
  jsonLd?: object | null;
}

const SITE_NAME = "AIBeatSync";
const BASE_URL = "https://aibeatsync.com";
const DEFAULT_OG_IMAGE = `${BASE_URL}/opengraph.jpg`;

export function useSEO({
  title,
  description,
  canonical,
  noindex = false,
  ogType = "website",
  ogImage = DEFAULT_OG_IMAGE,
  jsonLd,
}: SEOProps = {}) {
  const fullTitle = title
    ? `${title} | ${SITE_NAME}`
    : `${SITE_NAME} — AI Music Video Generator`;
  const canonicalUrl = canonical ? `${BASE_URL}${canonical}` : BASE_URL;

  useEffect(() => {
    // The router owns metadata for these routes, including noindex on dynamic
    // IDs; asynchronous page data must not overwrite robots or canonical later.
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path in publicRouteSeo || path === "/signup" || path.startsWith("/image/")) {
      if (jsonLd !== undefined) upsertJsonLd(jsonLd);
      return;
    }
    if (seoForPath(path).noindex) {
      setMeta("name", "robots", "noindex, nofollow");
    }
    document.title = fullTitle;

    setMeta("name", "description", description ?? "");
    setMeta("name", "robots", noindex || seoForPath(path).noindex ? "noindex, nofollow" : "index, follow, max-snippet:-1, max-image-preview:large");

    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", description ?? "");
    setMeta("property", "og:type", ogType);
    setMeta("property", "og:url", canonicalUrl);
    setMeta("property", "og:image", ogImage);

    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", description ?? "");
    setMeta("name", "twitter:image", ogImage);

    setLink("canonical", canonicalUrl);

    if (jsonLd !== undefined) {
      upsertJsonLd(jsonLd);
    }

    return () => {};
  }, [fullTitle, description, noindex, ogType, ogImage, canonicalUrl, jsonLd]);
}

function setMeta(attrName: string, attrValue: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(
    `meta[${attrName}="${attrValue}"]`
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLink(rel: string, href: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function upsertJsonLd(data: object | null) {
  const existing = document.querySelector<HTMLScriptElement>(
    'script[type="application/ld+json"][data-page]'
  );
  if (!data) {
    existing?.remove();
    return;
  }
  const script = existing ?? document.createElement("script");
  script.type = "application/ld+json";
  script.setAttribute("data-page", "true");
  script.textContent = JSON.stringify(data);
  if (!existing) document.head.appendChild(script);
}
