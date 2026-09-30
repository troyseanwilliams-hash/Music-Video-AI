// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Link, Route, Router, Switch } from "wouter";
import { RouteMetadata } from "./RouteMetadata";
import { useSEO } from "@/hooks/useSEO";

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
});

function LegacyLanding() {
  useEffect(() => {
    document.title = "Spotify Canvas Maker — AIBeatSync";
    document.querySelector('meta[name="description"]')?.setAttribute("content", "Make a looping Spotify Canvas for your track.");
  }, []);
  return <p>Canvas</p>;
}

function Registration() {
  // Existing page-specific hook must not override router-owned metadata.
  useSEO({ title: "Old registration title", canonical: "/register", noindex: true });
  return <p>Registration</p>;
}

it("navigates with Wouter and restores metadata after browser back including page effects", async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", "/");
  document.head.innerHTML = '<title>Old</title><meta name="description" content="Old"><link rel="canonical" href="https://aibeatsync.com/">';
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <Router>
      <RouteMetadata />
      <nav>
        <Link href="/images">Images</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/gallery">Gallery</Link>
        <Link href="/register">Register</Link>
        <Link href="/spotify-canvas">Canvas</Link>
      </nav>
      <Switch>
        <Route path="/register" component={Registration} />
        <Route path="/spotify-canvas" component={LegacyLanding} />
        <Route><p>Current page</p></Route>
      </Switch>
    </Router>,
  ));
  const click = async (name: string) => {
    const link = Array.from(container.querySelectorAll("a")).find(a => a.textContent === name);
    expect(link).toBeTruthy();
    await act(async () => { link!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  };
  const canonical = () => document.querySelector('link[rel="canonical"]')?.getAttribute("href");
  await click("Images");
  expect(document.title).toBe("AI Image Generator for Video Projects | AIBeatSync");
  expect(canonical()).toBe("https://aibeatsync.com/images");
  await click("Pricing");
  expect(document.title).toBe("AI Video, Image & Music Pricing | AIBeatSync");
  await click("Register");
  expect(document.title).toBe("Create Your AIBeatSync Account | AIBeatSync");
  expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
  await click("Gallery");
  expect(canonical()).toBe("https://aibeatsync.com/gallery");
  await click("Canvas");
  expect(document.title).toBe("Spotify Canvas Maker — AIBeatSync");
  expect(canonical()).toBe("https://aibeatsync.com/spotify-canvas");
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(window.location.pathname).toBe("/gallery");
  expect(document.title).toBe("Your Video & Image Gallery | AIBeatSync");
  expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
  expect(canonical()).toBe("https://aibeatsync.com/gallery");
  expect(document.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
});