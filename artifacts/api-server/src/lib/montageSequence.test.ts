import { readFile } from "fs/promises";
import { describe, expect, it } from "vitest";
import {
  resolveAvailableStitchSequence,
  resolveMontageSequence,
} from "./montageSequence.js";
import { resolveNarrativeSequence } from "./narrativeSequence.js";

function timeline(visualIndexes: number[]) {
  return visualIndexes.map((visualIndex, index) => ({
    index,
    visualIndex,
    startTime: index * 10,
    duration: 10,
  }));
}

describe("resolveMontageSequence", () => {
  it("truncates a stale long plan to the authoritative render duration", () => {
    const stale = timeline(Array.from({ length: 60 }, (_, index) => index % 20));
    const clips = Array.from({ length: 6 }, (_, visualIndex) => ({ visualIndex }));

    const sequence = resolveMontageSequence(stale, clips, 180, 10);

    expect(sequence).toHaveLength(18);
    expect(sequence.every((clipIndex) => clipIndex >= 0 && clipIndex < 6)).toBe(true);
  });

  it("extends a short persisted plan so the edit covers the full runtime", () => {
    const clips = [{ visualIndex: 0 }, { visualIndex: 1 }, { visualIndex: 2 }];

    const sequence = resolveMontageSequence(timeline([0, 1]), clips, 60, 10);

    expect(sequence).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it("preserves non-contiguous visual identities after partial finalization", () => {
    const survivingClips = [{ visualIndex: 2 }, { visualIndex: 4 }];

    const sequence = resolveMontageSequence(
      timeline([4, 2, 5, 4, 0, 2]),
      survivingClips,
      60,
      10,
    );

    expect(sequence).toHaveLength(6);
    expect(sequence[0]).toBe(1);
    expect(sequence[1]).toBe(0);
    expect(sequence.every((clipIndex, index) => index === 0 || clipIndex !== sequence[index - 1])).toBe(true);
  });
});

describe("resolveAvailableStitchSequence", () => {
  it("substitutes a corrupt source without consecutive repeats and returns the actual edit order", () => {
    const resolved = resolveAvailableStitchSequence(
      [0, 1, 0, 2, 0, 1],
      [1, 2],
      3,
    );

    expect(resolved).toHaveLength(6);
    expect(resolved.every((sourceIndex) => sourceIndex === 1 || sourceIndex === 2)).toBe(true);
    expect(resolved.every((sourceIndex, index) => index === 0 || sourceIndex !== resolved[index - 1])).toBe(true);
  });
});

describe("resolveNarrativeSequence", () => {
  it("returns every scene once in chronological order", () => {
    expect(resolveNarrativeSequence(5, [4, 2, 0, 3, 1])).toEqual([0, 1, 2, 3, 4]);
  });

  it("fails instead of substituting or repeating a missing scene", () => {
    expect(() => resolveNarrativeSequence(5, [0, 1, 3, 4])).toThrow(
      "missing required scene: 3",
    );
  });
});

describe("worker parity", () => {
  it("keeps the API and worker montage sequence implementations byte-identical", async () => {
    const [apiSource, workerSource] = await Promise.all([
      readFile(new URL("./montageSequence.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../worker/src/lib/montageSequence.ts", import.meta.url), "utf8"),
    ]);

    expect(workerSource).toBe(apiSource);
  });

  it("keeps the API and worker Narrative sequence implementations byte-identical", async () => {
    const [apiSource, workerSource] = await Promise.all([
      readFile(new URL("./narrativeSequence.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../worker/src/lib/narrativeSequence.ts", import.meta.url), "utf8"),
    ]);

    expect(workerSource).toBe(apiSource);
  });
});