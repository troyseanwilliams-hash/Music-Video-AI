import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { approvedPhotoAnimation } from "./jobProcessor.js";

describe("photo animation processor contract", () => {
  it("retains the exact approved prompt and one internal source", () => {
    const feature = {
      version: 1,
      approved: true,
      approvedPrompt: "Slow camera push-in, subtle natural motion",
      sourceObjectPath: "/objects/photo-animation-sources/pa_1/source.png",
      durationSeconds: 5,
    } as const;
    const resolved = approvedPhotoAnimation({ manifest: { photoAnimation: feature } } as never);
    expect(resolved).toEqual(feature);
    expect(resolved?.approvedPrompt).toBe(feature.approvedPrompt);
    expect(resolved?.sourceObjectPath).toBe(feature.sourceObjectPath);
  });

  it("rejects unapproved, remote, and non-5/10-second feature manifests", () => {
    const base = {
      version: 1,
      approved: true,
      approvedPrompt: "Exact approved motion",
      sourceObjectPath: "/objects/photo-animation-sources/pa_1/source.png",
      durationSeconds: 10,
    };
    expect(approvedPhotoAnimation({ manifest: { photoAnimation: { ...base, approved: false } } } as never)).toBeNull();
    expect(approvedPhotoAnimation({ manifest: { photoAnimation: { ...base, sourceObjectPath: "https://example.test/image.png" } } } as never)).toBeNull();
    expect(approvedPhotoAnimation({ manifest: { photoAnimation: { ...base, durationSeconds: 8 } } } as never)).toBeNull();
  });
});

describe.each([
  ["api-server", new URL("./jobProcessor.ts", import.meta.url)],
  ["worker", new URL("../../../worker/src/lib/jobProcessor.ts", import.meta.url)],
] as const)("%s photo animation paid-call contract", (_name, url) => {
  const source = readFileSync(fileURLToPath(url), "utf8");

  it("selects the retained source without generating a still", () => {
    expect(source).toMatch(
      /const photoAnimation = approvedPhotoAnimation\(job\);\s*if \(photoAnimation\) return \{ "0": photoAnimation\.sourceObjectPath \};/,
    );
  });

  it("uses the exact approved prompt and pins the selected provider", () => {
    expect(source).toMatch(
      /const prompt = photoAnimation\?\.approvedPrompt\s*\?\? visualShot\?\.prompt/,
    );
    expect(source).toContain("providerOnly: true");
    expect(source).toContain("provider,");
  });

  it("fails closed unless the plan is exactly one approved 5/10-second clip", () => {
    expect(source).toContain("Photo animation plan is not exactly one approved clip");
    expect(source).toMatch(/sections\.length !== 1|numClips !== 1|maxClips !== 1/);
  });
});