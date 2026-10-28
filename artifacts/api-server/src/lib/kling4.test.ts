import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildKling4Request, kling4Available, kling4Plan } from "./kling4.js";
import { validateKling4Frame } from "./kling4Frames.js";
import { calculateCreditCost, calculateGeneratedImageCost, getClipPlan } from "./creditCost.js";
// Dynamic paths keep cross-artifact test fixtures out of the API's TS rootDir.
const { calculateCreditCost: workerCreditCost } = await import(new URL("../../../worker/src/lib/creditCost.ts", import.meta.url).href);
const { buildKling4Request: workerRequest } = await import(new URL("../../../worker/src/lib/kling4.ts", import.meta.url).href);
const { estimateCreditCost, estimateGeneratedImageCost } = await import(new URL("../../../beatvision/src/lib/creditPricing.ts", import.meta.url).href);
import { stitchVideoClips } from "./videoStitcher.js";
import { planShots, shotPlanFingerprint } from "./shotPlan.js";
import { calculateImageFirstSettlement } from "./imageFirstSettlement.js";
import { resolveNewJobVideoProvider } from "./videoProviderSelection.js";
import { generateClip, pollPixazoRequestUntilComplete, resolveClipProviderChain } from "./videoApis.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Kling 4.0 contract", () => {
  it("is opt-in and keeps legacy routing unchanged", () => {
    vi.stubEnv("PIXAZO_API_KEY", "test");
    vi.stubEnv("KLING4_VERIFIED", "");
    vi.stubEnv("KLING_DIRECT_NEW_JOBS", "");
    expect(kling4Available()).toBe(false);
    expect(resolveClipProviderChain({ provider: "kling_v4", providerOnly: true })).toEqual([]);
    vi.stubEnv("KLING4_VERIFIED", "true");
    expect(resolveClipProviderChain({ provider: "kling_v4", providerOnly: true })).toEqual(["kling_v4"]);
    expect(resolveNewJobVideoProvider("kling")).toBe("kling");
    expect(resolveNewJobVideoProvider("kling_v4")).toBe("kling_v4");
  });

  it("uses numeric duration and first/last-frame fields without unsupported image parameters", () => {
    const input = { prompt: "A lake", durationSeconds: 17, resolution: "1080p", imageUrl: "https://owned/start.jpg", endImageUrl: "https://owned/end.jpg", aspectRatio: "9:16" };
    const request = buildKling4Request(input);
    expect(request.endpoint).toBe("https://gateway.pixazo.ai/kling-video-v4/v1/image-to-video");
    expect(request.body).toEqual({ prompt: "A lake", duration: 17, resolution: "1080p", start_image_url: input.imageUrl, end_image_url: input.endImageUrl });
    expect(workerRequest(input)).toEqual(request);
    expect(() => buildKling4Request({ prompt: "x", durationSeconds: 31 })).toThrow();
    expect(() => buildKling4Request({ prompt: "x", durationSeconds: 3.5 })).toThrow();
    expect(() => buildKling4Request({ prompt: "x", durationSeconds: 3, resolution: "4k" })).toThrow();
    expect(() => buildKling4Request({ prompt: "x", durationSeconds: 3, endImageUrl: "https://owned/end.jpg" })).toThrow();
  });

  it("matches planned scenes, frontend estimates, worker costs and image reservations for every supported runtime", () => {
    for (let seconds = 3; seconds <= 600; seconds++) {
      const duration = String(seconds);
      const plan = kling4Plan(seconds);
      expect(plan.clipDurationSec).toBeGreaterThanOrEqual(3);
      expect(plan.clipDurationSec).toBeLessThanOrEqual(30);
      expect(plan.numClips * plan.clipDurationSec).toBeGreaterThanOrEqual(seconds);
      expect(getClipPlan(duration, null, "narrative", "kling_v4")).toEqual(plan);
      const story = planShots({ prompt: "A lake at sunrise", requestedDuration: duration, generationMode: "narrative", aiProvider: "kling_v4" });
      expect(story.numClips).toBe(plan.numClips);
      expect(story.clipDurationSec).toBe(plan.clipDurationSec);
      expect(story.timeline.reduce((sum, scene) => sum + scene.duration, 0)).toBe(seconds);
      for (const resolution of ["720p", "1080p"]) {
        const cost = calculateCreditCost(duration, resolution, null, "kling_v4", "narrative");
        expect(workerCreditCost(duration, resolution, null, "kling_v4", "narrative")).toBe(cost);
        expect(estimateCreditCost(duration as any, "kling_v4", resolution, null, "narrative")).toBe(cost);
      }
      expect(calculateGeneratedImageCost(duration, null, "narrative", "generated_images", "kling_v4")).toBe(plan.numClips * 7);
      expect(estimateGeneratedImageCost(duration as any, null, "narrative", "generated_images", "kling_v4")).toBe(plan.numClips * 7);
    }
    expect(calculateCreditCost("3", "720p", null, "kling_v4", "narrative")).toBe(63);
    expect(calculateCreditCost("3", "1080p", null, "kling_v4", "narrative")).toBe(94);
    expect(calculateCreditCost("10", "720p", null, "kling", "narrative")).toBe(94);
  });

  it("requires renewed storyboard approval after changing models or ending frames", () => {
    const input = { prompt: "A lake", requestedDuration: "10", generationMode: "narrative" as const };
    const old = planShots(input);
    const next = planShots({ ...input, aiProvider: "kling_v4" });
    expect(shotPlanFingerprint(old)).not.toBe(shotPlanFingerprint(next));
    expect(shotPlanFingerprint(next)).not.toBe(shotPlanFingerprint({ ...next, endFrameImageAssetId: "new-frame" }));
  });

  it("decodes frame bytes and rejects invalid format and dimensions before billing", async () => {
    const image = sharp({ create: { width: 600, height: 400, channels: 3, background: "blue" } });
    await expect(validateKling4Frame(await image.clone().png().toBuffer())).resolves.toBeUndefined();
    await expect(validateKling4Frame(await image.clone().jpeg().toBuffer())).resolves.toBeUndefined();
    await expect(validateKling4Frame(await image.clone().webp().toBuffer())).rejects.toThrow();
    await expect(validateKling4Frame(await image.clone().resize(100, 100).png().toBuffer())).rejects.toThrow();
    await expect(validateKling4Frame(Buffer.from("not an image"))).rejects.toThrow();
    const route = readFileSync(new URL("../routes/jobs.ts", import.meta.url), "utf8");
    expect(route.indexOf("await validateKling4Frame(buffer)")).toBeLessThan(route.indexOf("const reservation = await db.transaction"));
    expect(route).toContain("eq(imageAssetsTable.userId, req.user.id), isNull(imageAssetsTable.deletedAt)");
  });

  it("settles only accepted scenes against the stored new-model reservation", () => {
    const videoCreditCost = calculateCreditCost("60", "1080p", null, "kling_v4", "narrative");
    const reserved = videoCreditCost + 14;
    const settlement = calculateImageFirstSettlement({
      reservedCredits: reserved, reservedTopupCredits: reserved,
      imageCreditCost: 14, videoCreditCost,
      storyboard: { shots: [{ index: 0 }, { index: 1 }] },
      partialClips: { "0": "stored" },
    }, 2);
    expect(settlement.chargedCredits).toBe(14 + Math.ceil(videoCreditCost / 2));
    expect(settlement.refundedCredits + settlement.chargedCredits).toBe(reserved);
  });

  it("persists the v4 handle before polling and can recover it while new submits are disabled", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PIXAZO_API_KEY", "test");
    vi.stubEnv("KLING4_VERIFIED", "true");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const pollUrl = "https://gateway.pixazo.ai/v2/requests/status/kling-video-v4_test";
    const completed = { status: "COMPLETED", model_id: "kling-video-v4", output: { media_url: ["https://cdn.example.com/test.mp4"] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "kling-video-v4_test", polling_url: pollUrl }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completed)));
    vi.stubGlobal("fetch", fetchMock);
    const result = generateClip({ prompt: "A lake", durationSeconds: 3, provider: "kling_v4", providerOnly: true, onSubmit });
    await vi.advanceTimersByTimeAsync(6000);
    await expect(result).resolves.toEqual({ videoUrl: completed.output.media_url[0], provider: "kling_v4" });
    expect(fetchMock.mock.calls[0]![0]).toContain("/kling-video-v4/v1/text-to-video");
    expect(onSubmit).toHaveBeenCalledWith({ provider: "kling_v4", requestId: "kling-video-v4_test", pollUrl });
    vi.stubEnv("KLING4_VERIFIED", "");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(completed)));
    const recovery = pollPixazoRequestUntilComplete(pollUrl);
    await vi.advanceTimersByTimeAsync(6000);
    await expect(recovery).resolves.toBe(completed.output.media_url[0]);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("keeps generated sound out of both stitchers", () => {
    for (const module of ["./videoStitcher.ts", "../../../worker/src/lib/videoStitcher.ts"]) {
      const code = readFileSync(new URL(module, import.meta.url), "utf8");
      expect(code).toContain("-an");
      expect(code).toContain('"-map", "1:a"');
    }
  });

  it("renders silently without a soundtrack and replaces generated sound with selected audio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kling-audio-test-"));
    try {
      const clipPath = join(dir, "clip.mp4");
      const musicPath = join(dir, "music.wav");
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x320:r=10:d=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", clipPath]);
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=3", musicPath]);
      const buffer = await readFile(clipPath);
      const silent = await stitchVideoClips({ clips: [{ buffer, targetDuration: 3 }], totalDuration: 3 });
      const silentPath = join(dir, "silent.mp4");
      await writeFile(silentPath, silent.videoBuffer);
      const streams = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", silentPath], { encoding: "utf8" })).streams;
      expect(streams.filter((s: { codec_type: string }) => s.codec_type === "audio")).toHaveLength(0);
      const output = await stitchVideoClips({ clips: [{ buffer, targetDuration: 3 }], totalDuration: 3, audioBuffer: await readFile(musicPath), audioExt: ".wav" });
      const outputPath = join(dir, "output.mp4");
      await writeFile(outputPath, output.videoBuffer);
      const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", outputPath, "-vn", "-ar", "8000", "-ac", "1", "-f", "s16le", "-"]);
      const power = (hz: number) => {
        let sin = 0, cos = 0;
        for (let i = 0; i < 8000; i++) {
          const sample = pcm.readInt16LE((i + 4000) * 2);
          sin += sample * Math.sin(2 * Math.PI * hz * i / 8000);
          cos += sample * Math.cos(2 * Math.PI * hz * i / 8000);
        }
        return sin * sin + cos * cos;
      };
      expect(power(880)).toBeGreaterThan(power(440) * 100);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30000);

  it("keeps the actual ending frame in a 45-second export of two paid 23-second scenes", async () => {
    const { stitchVideoClips: workerStitch } = await import(new URL("../../../worker/src/lib/videoStitcher.ts", import.meta.url).href);
    const dir = await mkdtemp(join(tmpdir(), "kling-ending-test-"));
    try {
      const path = join(dir, "scene.mp4");
      // Only the last 0.2 seconds are red; a simple total-runtime trim loses it.
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=30:d=23", "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='gte(t,22.8)'", "-c:v", "libx264", "-threads", "1", path]);
      const buffer = await readFile(path);
      for (const [name, stitch] of [["api", stitchVideoClips], ["worker", workerStitch]] as const) {
        const result = await stitch({
          clips: [{ buffer, targetDuration: 23 }, { buffer, targetDuration: 23 }],
          totalDuration: 45, strictSequence: true, preserveEndFrame: true,
        });
        const output = join(dir, `${name}.mp4`);
        await writeFile(output, result.videoBuffer);
        const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output], { encoding: "utf8" }).trim());
        expect(Math.abs(duration - 45), `${name}: ${execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,start_time:stream=duration,start_time,nb_frames,r_frame_rate", "-of", "json", output], { encoding: "utf8" })}`).toBeLessThan(0.04);
        const pixel = execFileSync("ffmpeg", ["-v", "error", "-ss", "44.95", "-i", output, "-frames:v", "1", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
        expect(pixel.length).toBe(3);
        expect(pixel[0]).toBeGreaterThan(200);
        expect(pixel[2]).toBeLessThan(30);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30000);
});
