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

  it("preserves exact primary CTA Create your first music video", () => {
    const homeContent = fs.readFileSync(path.join(__dirname, "../pages/home.tsx"), "utf-8");
    expect(homeContent).toContain("Create your first music video");
  });
});
