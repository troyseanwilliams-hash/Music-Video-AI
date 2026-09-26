import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const processors = [
  ["API", new URL("./jobProcessor.ts", import.meta.url)],
  ["worker", new URL("../../../worker/src/lib/jobProcessor.ts", import.meta.url)],
] as const;

describe.each(processors)("%s Suno job audio", (_name, url) => {
  const source = readFileSync(fileURLToPath(url), "utf8");
  const getAudio = source.slice(source.indexOf("async function getAudioBuffer("), source.indexOf("const STYLE_PROMPTS:"));

  it("uses an existing owned audioObjectPath before any legacy CDN access", () => {
    expect(getAudio.indexOf("if (job.audioObjectPath)")).toBeGreaterThanOrEqual(0);
    expect(getAudio.indexOf("if (job.audioObjectPath)")).toBeLessThan(getAudio.indexOf('if (job.audioSourceType === "suno")'));
    expect(getAudio).toContain("storageService.downloadObjectBuffer(job.audioObjectPath)");
    expect(getAudio).toMatch(/return \{ buffer: buf, ext \};/);
    expect(getAudio).not.toContain("fetch(job.audioSourceUrl");
  });

  it("fails explicitly if an owned imported object is missing; supports pre-import CDN-only jobs safely", () => {
    expect(getAudio).toMatch(/catch \(err\) \{\s*if \(job.audioSourceType === "suno"\) throw new Error\("Imported Suno audio is unavailable in object storage/);
    expect(getAudio).toContain("if (!job.audioSourceUrl) throw new Error(");
    expect(getAudio).toContain("downloadLegacySunoAudio(job.audioSourceUrl)");
    expect(source).toContain("if (job.audioObjectPath || job.audioSourceType === \"suno\")");
  });

  it("does not follow arbitrary CDN redirects on pre-import jobs", () => {
    if (_name === "worker") {
      expect(source).toContain('if (!trusted(current)) throw new Error("Legacy Suno audio URL is not a trusted CDN URL');
      expect(source).toContain('redirect: "manual"');
      expect(source).toContain("current = new URL(location, current).toString()");
    } else {
      expect(source).toContain('import { downloadLegacySunoAudio } from "./sunoResolver.js"');
    }
  });
});