import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Copy verification", () => {
  it("does not contain podcast promotional copy on home page", () => {
    const homeContent = fs.readFileSync(path.join(__dirname, "../pages/home.tsx"), "utf-8");
    expect(homeContent.toLowerCase()).not.toContain("podcast media");
    expect(homeContent.toLowerCase()).not.toContain("podcast release");
    expect(homeContent.toLowerCase()).not.toContain("podcast clip");
  });

  it("does not contain unsupported instant/perfect claims on home page", () => {
    const homeContent = fs.readFileSync(path.join(__dirname, "../pages/home.tsx"), "utf-8");
    expect(homeContent.toLowerCase()).not.toContain("instant perfect results");
    expect(homeContent.toLowerCase()).not.toContain("#1");
  });

  it("does not promise guaranteed ownership/quality on home page", () => {
    const homeContent = fs.readFileSync(path.join(__dirname, "../pages/home.tsx"), "utf-8");
    expect(homeContent.toLowerCase()).not.toContain("guaranteed quality");
    expect(homeContent.toLowerCase()).not.toContain("you fully own");
  });

  it("offers a clear Montage Studio CTA for editing the user's own footage", () => {
    const homeContent = fs.readFileSync(path.join(__dirname, "../pages/home.tsx"), "utf-8");
    expect(homeContent).toContain("Open Montage Studio");
    expect(homeContent).toContain('data-testid="link-hero-montage"');
  });

  it("uses proper explicit auth intent via buildAuthUrl for editor and generate", () => {
    const homeContent = fs.readFileSync(path.join(__dirname, "../pages/home.tsx"), "utf-8");
    expect(homeContent).toContain('buildAuthUrl("/register", { returnTo: "/editor" })');
    expect(homeContent).toContain('buildAuthUrl("/register", { returnTo: "/generate" })');
  });

  it("prioritizes Montage in primary CTAs and public navigation", () => {
    const navbarContent = fs.readFileSync(path.join(__dirname, "../components/layout/Navbar.tsx"), "utf-8");
    const footerContent = fs.readFileSync(path.join(__dirname, "../components/layout/Footer.tsx"), "utf-8");

    // Editor should be first in public nav
    expect(navbarContent).toContain('{ href: "/editor", label: "Montage"');

    // Editor should be first in Create footer section
    const createIndex = footerContent.indexOf('title: "Create"');
    const editorIndex = footerContent.indexOf('"/editor"', createIndex);
    const generateIndex = footerContent.indexOf('"/generate"', createIndex);
    expect(editorIndex).toBeLessThan(generateIndex);
  });
});
