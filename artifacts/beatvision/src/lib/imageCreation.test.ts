import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeNumberedScenes, imageCreationRedirect } from "./imageCreation";

describe("standalone image links and scene scripts", () => {
  it("moves legacy image-mode deep links without dropping compatible settings", () => {
    const destination = imageCreationRedirect("?mode=images&prompt=A%20red%20fox&imageCount=3&style=anime&referenceImagePath=%2Fobjects%2Ffox.png&aspectRatio=16%3A9");
    const url = new URL(destination!, "https://example.com");
    expect(url.pathname).toBe("/images");
    expect(url.searchParams.get("prompt")).toBe("A red fox");
    expect(url.searchParams.get("imageCount")).toBe("3");
    expect(url.searchParams.get("style")).toBe("anime");
    expect(url.searchParams.get("referenceImagePath")).toBe("/objects/fox.png");
    expect(url.searchParams.get("aspectRatio")).toBe("16:9");
    expect(url.searchParams.has("mode")).toBe(false);
  });

  it("leaves video handoffs on the video page and counts ordered image scripts", () => {
    expect(imageCreationRedirect("?prompt=video&audioObjectPath=%2Fobjects%2Fmusic")).toBeNull();
    expect(analyzeNumberedScenes("1. First scene\n2. Second scene", 30)).toEqual({ count: 2, invalid: false });
    expect(analyzeNumberedScenes("1. First scene\n3. Skipped scene", 30).invalid).toBe(true);
  });

  it("keeps Generate Video free of an image-only action and exposes the dedicated routes", () => {
    const generate = readFileSync(new URL("../pages/generate.tsx", import.meta.url), "utf8");
    const routes = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const gallery = readFileSync(new URL("../pages/gallery.tsx", import.meta.url), "utf8");
    expect(generate).not.toContain('data-testid="toggle-image-pack-mode"');
    expect(generate).toContain("const imagePackMode = false;");
    expect(generate).toContain('<Link href="/images"');
    expect(routes).toContain('<Route path="/generate" component={GenerateRoute} />');
    expect(routes).toContain('<Route path="/images" component={CreateImages} />');
    expect(gallery).toContain('<Link href="/images">');
  });
});