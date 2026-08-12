import { useEffect } from "react";
import { useLocation } from "wouter";

// Scrolls to the top of the page on every route change. Wouter (like most
// SPA routers) doesn't reset scroll position on navigation by default, so
// without this, clicking a link partway down a page would leave the next
// page scrolled to the same spot instead of starting at the top.
export function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}
