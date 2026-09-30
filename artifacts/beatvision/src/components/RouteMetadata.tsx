import { useEffect } from "react";
import { useLocation } from "wouter";
import { applyRouteSeo, legacyPublicPaths, seoForPath } from "@/lib/routeSeo";

export function RouteMetadata() {
  const [location] = useLocation();
  useEffect(() => {
    const seo = seoForPath(location);
    if (legacyPublicPaths.has(seo.path)) {
      // Older landing pages still manage their own page title/description.
      // Their child effects run before this parent's effect.
      seo.title = document.title;
      seo.description = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? seo.description;
    }
    applyRouteSeo(seo);
  }, [location]);
  return null;
}