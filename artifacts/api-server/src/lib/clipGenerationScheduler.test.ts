import { describe, expect, it } from "vitest";
import {
  lazyBuffer,
  materializeLazyBuffers,
  pendingFirstOrder,
  resolveSceneConcurrency,
  runBoundedScenes,
} from "./clipGenerationScheduler.js";

describe("clip generation scheduling", () => {
  it("defaults to two, caps at three, and supports forced sequential modes", () => {
    expect(resolveSceneConcurrency()).toBe(2);
    expect(resolveSceneConcurrency({ requested: 99 })).toBe(3);
    expect(resolveSceneConcurrency({ requested: 3, forceSequential: true })).toBe(1);
  });

  it("puts every accepted pending request before other scene work", () => {
    expect(pendingFirstOrder([0, 1, 2, 3], { 1: "poll-1", 3: "poll-3" })).toEqual([1, 3, 0, 2]);
  });

  it("bounds concurrency and preserves positions when work finishes in reverse order", async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const resultPromise = runBoundedScenes([0, 1, 2], 2, async (index) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => { releases[index] = resolve; });
      active--;
      return `clip-${index}`;
    });
    await Promise.resolve();
    releases[1]!();
    await Promise.resolve();
    releases[0]!();
    await Promise.resolve();
    releases[2]!();
    expect(await resultPromise).toEqual(["clip-0", "clip-1", "clip-2"]);
    expect(peak).toBe(2);
  });

  it("does not read a saved clip until materialization", async () => {
    let reads = 0;
    const clip = { ...lazyBuffer(async () => { reads++; return Buffer.from("saved"); }), targetDuration: 10 };
    expect(reads).toBe(0);
    await materializeLazyBuffers([clip]);
    expect(reads).toBe(1);
    expect(clip.buffer.toString()).toBe("saved");
  });

  it("waits for accepted in-flight work after one lane fails and starts nothing else", async () => {
    const started: number[] = [];
    let releaseAccepted!: () => void;
    const accepted = new Promise<void>((resolve) => { releaseAccepted = resolve; });
    let acceptedSettled = false;
    const result = runBoundedScenes([0, 1, 2], 2, async (index) => {
      started.push(index);
      if (index === 0) throw new Error("terminal");
      await accepted;
      acceptedSettled = true;
    });
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    releaseAccepted();
    await expect(result).rejects.toThrow("terminal");
    expect(acceptedSettled).toBe(true);
    expect(started).not.toContain(2);
  });

  it("signals a shared paid-work stop before an in-flight lane resumes", async () => {
    let stopPaidWork = false;
    let releasePeer!: () => void;
    const peerGate = new Promise<void>((resolve) => { releasePeer = resolve; });
    let peerSubmitted = false;
    const result = runBoundedScenes(
      [0, 1],
      2,
      async (index) => {
        if (index === 0) throw new Error("terminal");
        await peerGate;
        if (!stopPaidWork) peerSubmitted = true;
      },
      () => !stopPaidWork,
      () => { stopPaidWork = true; },
    );
    await Promise.resolve();
    releasePeer();
    await expect(result).rejects.toThrow("terminal");
    expect(peerSubmitted).toBe(false);
  });
});