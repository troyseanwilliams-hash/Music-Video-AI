import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { stitchEditorTimeline } from "./editorStitcher.js";
import { layerChunkBoundaries, type EditorOverlayInput } from "./editorLayers.js";
import { editorLayersShape, validateEditorTiming } from "./editorLayersSchema.js";

function command(program: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args);
    const out: Buffer[] = [];
    let error = "";
    child.stdout.on("data", (data: Buffer) => out.push(data));
    child.stderr.on("data", (data: Buffer) => { error = (error + data.toString()).slice(-3000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(error)));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function fixture(duration: number, color: string, frequency: number, portrait = false) {
  return command("ffmpeg", [
    "-v", "error", "-threads", "2", "-filter_threads", "1",
    "-f", "lavfi", "-i", `color=c=${color}:s=${portrait ? "90x160" : "320x180"}:r=30:d=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    ...(portrait ? ["-vf", "drawbox=x=0:y=140:w=90:h=20:color=white:t=fill"] : []),
    "-t", String(duration), "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+frag_keyframe+empty_moov", "-f", "mp4", "pipe:1",
  ]);
}
async function frame(path: string, time: number, w = 320, h = 180) {
  return command("ffmpeg", ["-v", "error", "-threads", "2", "-ss", String(time), "-i", path,
    "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
}
function pixel(buffer: Buffer, x: number, y: number, width = 320) {
  return [...buffer.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
}
async function amplitude(path: string, time: number, frequency: number) {
  const audio = await command("ffmpeg", ["-v", "error", "-ss", String(time), "-i", path,
    "-t", "0.2", "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"]);
  let re = 0, im = 0;
  for (let i = 0; i < audio.length / 4; i++) {
    const value = audio.readFloatLE(i * 4);
    re += value * Math.cos(2 * Math.PI * frequency * i / 8000);
    im += value * Math.sin(2 * Math.PI * frequency * i / 8000);
  }
  return Math.hypot(re, im) / (audio.length / 4);
}
const layer = (buffer: Buffer, overrides: Partial<EditorOverlayInput> = {}): EditorOverlayInput => ({
  id: "overlay", name: "Vertical source", objectPath: "/objects/uploads/test/clip",
  startSec: 0.5, durationSec: 1, trimStart: 0,
  x: 0.7, y: 0.1, width: 0.25, height: 0.8,
  layout: "reaction", volume: 0, cornerRadius: 0, borderWidth: 0, borderColor: "#ffffff",
  buffer, ...overrides,
});
const timingSchema = z.object({
  segments: z.array(z.object({ kind: z.string(), durationSec: z.number(), trimStart: z.number().optional(), trimEnd: z.number().optional() })),
  ...editorLayersShape,
}).superRefine(validateEditorTiming);

describe("Montage layer contracts", () => {
  it("round-trips timed music and rejects invalid, out-of-bounds or overcrowded slots", () => {
    const clip = { id: "intro", name: "Intro", objectPath: "/objects/audio/intro",
      startSec: 0, durationSec: 5, trimStart: 1.25, volume: 0.25 };
    const input = { segments: [{ kind: "video", durationSec: 20 }], audioClips: [
      clip, { ...clip, id: "later", startSec: 12.5 },
    ] };
    expect(timingSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
    for (const patch of [{ durationSec: 0 }, { startSec: -1 }, { trimStart: -1 },
      { volume: 2 }, { startSec: 19 }, { startSec: NaN }]) {
      expect(timingSchema.safeParse({ ...input, audioClips: [{ ...clip, ...patch }] }).success).toBe(false);
    }
    expect(timingSchema.safeParse({ ...input, audioClips: Array.from({ length: 5 }, (_, i) => ({ ...clip, id: String(i) })) }).success).toBe(false);
    expect(timingSchema.safeParse({ ...input, audioClips: Array.from({ length: 101 }, (_, i) => ({ ...clip, id: String(i) })) }).success).toBe(false);
  });
  it("preserves multiple mixed-media time slots through saved JSON and validation", () => {
    const { buffer: _, ...video } = layer(Buffer.alloc(0));
    const input = { segments: [{ kind: "video", durationSec: 20 }], overlays: [
      { ...video, id: "first", startSec: 1.25, durationSec: 2.5 },
      { ...video, id: "second", startSec: 8.5, durationSec: 4 },
      { ...video, kind: "image", id: "still", startSec: 8.5, durationSec: 4 },
    ] };
    expect(timingSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
    expect(timingSchema.safeParse({ ...input, overlays: [{ ...input.overlays[2], volume: 1 }] }).success).toBe(false);
  });
  it("accepts legacy projects and exactly thirty minutes, rejects longer projects", () => {
    expect(timingSchema.safeParse({ segments: [{ kind: "video", durationSec: 1800 }] }).success).toBe(true);
    expect(timingSchema.safeParse({ segments: [{ kind: "video", durationSec: 1801 }] }).success).toBe(false);
  });
  it("rejects layers beyond the timeline and excessive overlapping decoders", () => {
    const { buffer: _buffer, ...overlay } = layer(Buffer.alloc(0));
    expect(timingSchema.safeParse({ segments: [{ kind: "photo", durationSec: 1 }], overlays: [overlay] }).success).toBe(false);
    expect(timingSchema.safeParse({ segments: [{ kind: "photo", durationSec: 3 }], overlays:
      Array.from({ length: 5 }, (_, i) => ({ ...overlay, id: String(i) })) }).success).toBe(false);
  });
  it("bounds long renders to windows with layer edges included", () => {
    const points = layerChunkBoundaries(1200, [layer(Buffer.alloc(0), { startSec: 1150, durationSec: 10 })], []);
    expect(points).toContain(1150);
    expect(points).toContain(1160);
    expect(points.at(-1)).toBe(1200);
    expect(points.slice(1).every((value, i) => value - points[i]! <= 30)).toBe(true);
  });
});

describe("Montage layer exports", () => {
  it("fades music across overlapping clip boundaries without restarting the fade", async () => {
    const dir = await mkdtemp(join(tmpdir(), "music-fade-test-"));
    try {
      const main = await fixture(6, "blue", 440);
      const song = await fixture(6, "black", 880);
      const clip = { id: "fade", name: "Song", objectPath: "/objects/audio/song",
        startSec: 0, durationSec: 6, trimStart: 0, volume: 1, buffer: song, ext: "mp4",
        fadeInSec: 2, fadeOutSec: 2 };
      const result = await stitchEditorTimeline({
        segments: [{ buffer: main, kind: "video", durationSec: 6 }], width: 320, height: 180,
        audioClips: [clip, { ...clip, id: "boundary", startSec: 1, durationSec: 4, volume: 0, fadeInSec: 0, fadeOutSec: 0 }],
      });
      const path = join(dir, "out.mp4");
      await writeFile(path, result.videoBuffer);
      const full = await amplitude(path, 3, 880);
      expect(full).toBeGreaterThan(0.035);
      const early = await amplitude(path, 0.2, 880);
      const middle = await amplitude(path, 1.2, 880);
      const late = await amplitude(path, 5.6, 880);
      expect(early / full).toBeLessThan(0.3);
      expect(middle / full).toBeGreaterThan(0.5);
      expect(middle / full).toBeLessThan(0.85);
      expect(late / full).toBeLessThan(0.3);
      expect(await amplitude(path, 1.2, 440)).toBeLessThan(0.005);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120_000);
  it("mutes underlying audio until the last overlapping music clip ends, then restores it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "music-mix-test-"));
    try {
      const main = await fixture(3, "blue", 440);
      const overlay = await fixture(2, "red", 880, true);
      const song = await fixture(3, "black", 1320);
      const background = await fixture(3, "black", 220);
      const clip = { id: "one", name: "Song", objectPath: "/objects/audio/song",
        startSec: 0.5, durationSec: 1, trimStart: 0, volume: 0.25, buffer: song, ext: "mp4" };
      const result = await stitchEditorTimeline({
        segments: [{ buffer: main, kind: "video", durationSec: 3 }], width: 320, height: 180,
        overlays: [layer(overlay, { durationSec: 1.5, volume: 0.25 })],
        music: { buffer: background, ext: "mp4", mode: "mix", volume: 0.25 },
        audioClips: [clip, { ...clip, id: "two", startSec: 1, volume: 0.25 }],
      });
      const path = join(dir, "out.mp4");
      await writeFile(path, result.videoBuffer);
      for (const time of [0.7, 1.1, 1.7]) {
        for (const frequency of [220, 440, 880])
          expect(await amplitude(path, time, frequency)).toBeLessThan(0.005);
        expect(await amplitude(path, time, 1320)).toBeGreaterThan(0.006);
      }
      expect(await amplitude(path, 0.1, 440)).toBeGreaterThan(0.02);
      expect(await amplitude(path, 2.3, 440)).toBeGreaterThan(0.02);
      expect(await amplitude(path, 2.3, 1320)).toBeLessThan(0.005);
      expect(await amplitude(path, 2.3, 220)).toBeGreaterThan(0.006);
      expect(pixel(await frame(path, 1.1), 260, 80)[0]).toBeGreaterThan(200);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120_000);

  it("mixes repeated timed music with source offsets, silence between slots and independent volume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "timed-music-test-"));
    try {
      const main = await fixture(6, "blue", 440);
      const song = await command("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
        "aevalsrc=0.125*sin(2*PI*if(lt(t\\,1.5)\\,880\\,1320)*t):s=48000:d=4",
        "-f", "wav", "pipe:1"]);
      const clip = { id: "intro", name: "Music", objectPath: "/objects/audio/track",
        startSec: 0.5, durationSec: 1, trimStart: 0, volume: 0.25, buffer: song, ext: "wav" };
      const result = await stitchEditorTimeline({
        segments: [{ buffer: main, kind: "video", durationSec: 6 }], width: 320, height: 180,
        audioClips: [clip, { ...clip, id: "later", startSec: 2, trimStart: 2, volume: 1 },
          { ...clip, id: "muted", startSec: 4, volume: 0 }],
      });
      const path = join(dir, "out.mp4");
      await writeFile(path, result.videoBuffer);
      expect(await amplitude(path, 0.7, 880)).toBeGreaterThan(0.008);
      expect(await amplitude(path, 0.7, 880)).toBeLessThan(0.025);
      expect(await amplitude(path, 2.3, 1320)).toBeGreaterThan(0.035);
      expect(await amplitude(path, 2.3, 880)).toBeLessThan(0.005);
      expect(await amplitude(path, 0.7, 440)).toBeLessThan(0.005);
      expect(await amplitude(path, 2.3, 440)).toBeLessThan(0.005);
      for (const time of [0.1, 1.7, 3.3, 4.3, 5.5]) {
        expect(await amplitude(path, time, 880)).toBeLessThan(0.005);
        expect(await amplitude(path, time, 1320)).toBeLessThan(0.005);
        expect(await amplitude(path, time, 440)).toBeGreaterThan(0.035);
      }
      expect(pixel(await frame(path, 5.5), 100, 80)[2]).toBeGreaterThan(200);
      expect(result.durationSeconds).toBeCloseTo(6, 1);
      await expect(stitchEditorTimeline({
        segments: [{ buffer: main, kind: "video", durationSec: 6 }], width: 320, height: 180,
        audioClips: [{ ...clip, trimStart: 3.5 }],
      })).rejects.toThrow("shorter than its selected time slot");
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120_000);

  it("renders multiple video and static-image slots at saved times, including overlap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layers-mixed-"));
    try {
      const main = await fixture(4, "blue", 440);
      const clip = await fixture(1.5, "red", 880, true);
      const image = await command("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
        "color=c=lime:s=90x160", "-frames:v", "1", "-threads", "2", "-f", "image2pipe", "-c:v", "png", "pipe:1"]);
      const result = await stitchEditorTimeline({
        segments: [{ buffer: main, kind: "video", durationSec: 4 }], width: 320, height: 180,
        overlays: [
          layer(clip, { id: "first", startSec: 0.5, durationSec: 1 }),
          layer(clip, { id: "second", startSec: 2, durationSec: 1 }),
          layer(image, { kind: "image", id: "still", startSec: 1, durationSec: 2.5, x: 0.1, ext: "png" }),
        ],
      });
      const path = join(dir, "out.mp4");
      await writeFile(path, result.videoBuffer);
      for (const t of [0.2, 1.8, 3.7])
        expect(pixel(await frame(path, t), 260, 80)[2]).toBeGreaterThan(200);
      for (const t of [0.8, 2.3])
        expect(pixel(await frame(path, t), 260, 80)[0]).toBeGreaterThan(200);
      for (const t of [1.2, 1.8, 2.3, 3.3])
        expect(pixel(await frame(path, t), 70, 80)[1]).toBeGreaterThan(200);
      for (const t of [0.8, 3.7])
        expect(pixel(await frame(path, t), 70, 80)[2]).toBeGreaterThan(200);
      expect(await amplitude(path, 2.3, 440)).toBeGreaterThan(0.035);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120_000);

  it("exports a reaction clip with preserved main video, source watermark, rounding and border", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layers-test-"));
    try {
      const main = await fixture(2, "blue", 440);
      const clip = await fixture(1.4, "red", 880, true);
      const result = await stitchEditorTimeline({
        segments: [{ buffer: main, kind: "video", durationSec: 2 }], width: 320, height: 180,
        overlays: [layer(clip, { cornerRadius: 0.02, borderWidth: 0.005 })],
      });
      const path = join(dir, "out.mp4");
      await writeFile(path, result.videoBuffer);
      const before = await frame(path, 0.2);
      const during = await frame(path, 0.9);
      const after = await frame(path, 1.8);
      expect(pixel(before, 260, 80)[2]).toBeGreaterThan(200);
      expect(pixel(during, 260, 80)[0]).toBeGreaterThan(200);
      expect(pixel(during, 20, 80)[2]).toBeGreaterThan(200);
      expect(pixel(after, 260, 80)[2]).toBeGreaterThan(200);
      expect(pixel(during, 260, 150).every((v) => v > 200)).toBe(true);
      expect(await amplitude(path, 0.8, 880)).toBeLessThan(0.005);
      expect(result.durationSeconds).toBeCloseTo(2, 0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120_000);

  it("exports commentary blur fill with lowered audio and a timed text card", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layers-test-"));
    try {
      const main = await fixture(2, "blue", 440);
      const clip = await fixture(1.4, "red", 880, true);
      const result = await stitchEditorTimeline({
        segments: [{ buffer: main, kind: "video", durationSec: 2 }], width: 320, height: 180,
        overlays: [layer(clip, { layout: "commentary", volume: 0.25 })],
        textCards: [{ id: "text", text: "$2,900/month: 100% 'mine'\nSecond line",
          startSec: 0.5, durationSec: 1, x: 0.02, y: 0.05, fontSize: 0.05,
          color: "#ffffff", backgroundColor: "#000000" }],
      });
      const path = join(dir, "out.mp4");
      await writeFile(path, result.videoBuffer);
      const during = await frame(path, 0.9);
      expect(pixel(during, 10, 100)[0]).toBeGreaterThan(180);
      expect(pixel(during, 160, 100)[0]).toBeGreaterThan(200);
      expect(pixel(during, 160, 170).every((v) => v > 200)).toBe(true);
      const mainAmp = await amplitude(path, 0.8, 440);
      const overlayAmp = await amplitude(path, 0.8, 880);
      expect(mainAmp).toBeGreaterThan(0.035);
      expect(overlayAmp / mainAmp).toBeGreaterThan(0.15);
      expect(overlayAmp / mainAmp).toBeLessThan(0.4);
      const textArea = pixel(during, 7, 10);
      expect(textArea[0]).toBeLessThan(100);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120_000);

  it("exports full overlay audio and genuine 1920x1080 video", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layers-test-"));
    try {
      const main = await fixture(2, "blue", 440);
      const clip = await fixture(1.4, "red", 880, true);
      const result = await stitchEditorTimeline({
        segments: [{ buffer: main, kind: "video", durationSec: 2 }], width: 1920, height: 1080,
        overlays: [layer(clip, { volume: 1 })],
      });
      const path = join(dir, "out.mp4");
      await writeFile(path, result.videoBuffer);
      const probe = JSON.parse((await command("ffprobe", ["-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", path])).toString());
      expect(probe.streams[0]).toMatchObject({ width: 1920, height: 1080 });
      const ratio = await amplitude(path, 0.8, 880) / await amplitude(path, 0.8, 440);
      expect(ratio).toBeGreaterThan(0.7);
      expect(ratio).toBeLessThan(1.3);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120_000);

  it.runIf(process.env.RUN_LONG_EDITOR_TEST === "1")("exports a twenty-minute 1080p episode without truncating its late overlay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layers-long-test-"));
    try {
      const main = await fixture(1200, "blue", 440);
      const clip = await fixture(2, "red", 880, true);
      const result = await stitchEditorTimeline({
        segments: [{ buffer: main, kind: "video", durationSec: 1200 }], width: 1920, height: 1080,
        overlays: [layer(clip, { startSec: 1195, durationSec: 2, volume: 0.25 })],
        textCards: [{ id: "last-card", text: "End of episode", startSec: 1190, durationSec: 10,
          x: 0.02, y: 0.05, fontSize: 0.05, color: "#ffffff", backgroundColor: "#000000" }],
      });
      expect(result.durationSeconds).toBeGreaterThanOrEqual(1199.9);
      expect(result.durationSeconds).toBeLessThan(1200.2);
      const path = join(dir, "out.mp4");
      await writeFile(path, result.videoBuffer);
      const late = await frame(path, 1196);
      expect(pixel(late, 260, 80)[0]).toBeGreaterThan(180);
      expect(pixel(late, 20, 100)[2]).toBeGreaterThan(180);
      const beforeOverlay = await frame(path, 1194.8);
      const overlayStart = await frame(path, 1195.2);
      const afterOverlay = await frame(path, 1197.2);
      expect(pixel(beforeOverlay, 260, 80)[2]).toBeGreaterThan(180);
      expect(pixel(overlayStart, 260, 80)[0]).toBeGreaterThan(180);
      expect(pixel(afterOverlay, 260, 80)[2]).toBeGreaterThan(180);
      const probe = JSON.parse((await command("ffprobe", ["-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", path])).toString());
      expect(probe.streams[0]).toMatchObject({ width: 1920, height: 1080 });
      // Exercise reading the last bytes too, not just container metadata.
      expect((await readFile(path)).length).toBeGreaterThan(10000);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 900_000);
});
