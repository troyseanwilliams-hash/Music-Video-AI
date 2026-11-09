import { useEffect } from "react";
import { useLocation } from "wouter";

// Scrolls to the top of the page on every route change. Wouter (like most
// SPA routers) doesn't reset scroll position on navigation by default, so
// without this, clicking a link partway down a page would leave the next
// page scrolled to the same spot instead of starting at the top.
export function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    if (window.location.hash) {
      const frame = requestAnimationFrame(() => {
        let id = window.location.hash.slice(1);
        try { id = decodeURIComponent(id); } catch { /* Keep malformed anchors literal. */ }
        const target = document.getElementById(id);
        if (target) target.scrollIntoView({ block: "start" });
        else window.scrollTo(0, 0);
      });
      return () => cancelAnimationFrame(frame);
    }
    window.scrollTo(0, 0);
    return undefined;
  }, [location]);
  return null;
}
