import { useEffect } from "react";

const SITE_URL = "https://aisyncsuite.com";

export function useSEO({
  title,
  description,
  canonical,
  noindex = false,
}: {
  title: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
}) {
  useEffect(() => {
    document.title = title;
    setMeta(
      "name",
      "robots",
      noindex
        ? "noindex, nofollow"
        : "index, follow, max-snippet:-1, max-image-preview:large",
    );

    if (description) {
      setMeta("name", "description", description);
      setMeta("property", "og:description", description);
      setMeta("name", "twitter:description", description);
    }

    setMeta("property", "og:title", title);
    setMeta("property", "og:type", "website");
    setMeta("name", "twitter:title", title);

    if (canonical) {
      const canonicalUrl = new URL(canonical, SITE_URL).toString();
      let linkCanonical = document.querySelector('link[rel="canonical"]');
      if (!linkCanonical) {
        linkCanonical = document.createElement('link');
        linkCanonical.setAttribute('rel', 'canonical');
        document.head.appendChild(linkCanonical);
      }
      linkCanonical.setAttribute('href', canonicalUrl);
      setMeta("property", "og:url", canonicalUrl);
    }
  }, [title, description, canonical, noindex]);
}

function setMeta(attribute: "name" | "property", key: string, content: string) {
  let element = document.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"]`,
  );
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}
