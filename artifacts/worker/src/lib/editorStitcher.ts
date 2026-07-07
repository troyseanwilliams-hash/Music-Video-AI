// editorStitcher.ts — user-driven Studio render. The timeline counterpart to
// videoStitcher.ts: it takes an ordered list of segments (videos + still photos),
// normalizes them to a common format, joins them (hard cut OR a transition
// crossfade chain), lays a music track over the top (mix or replace), optionally
// stamps a free-tier watermark, and returns the final MP4 + thumbnail buffers.
//
// A single bad segment is skipped rather than failing the whole render.
import { spawn } from "node:child_process";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export interface EditorSegmentInput {
  buffer: Buffer;
  kind: "video" | "photo";
  durationSec: number; // for photos: how long to show; for videos: ignored (full clip)
  ext?: string; // source extension hint (e.g. "mp4", "jpg")
}

export interface EditorMusicInput {
  buffer: Buffer;
  ext: string;
  mode: "mix" | "replace";
  volume: number; // 0..1
}

export interface EditorStitchInput {
  segments: EditorSegmentInput[];
  music?: EditorMusicInput;
  transition?: { type: string; durationSec: number }; // type "none" => hard cut
  width?: number;
  height?: number;
  fps?: number;
  watermark?: boolean; // free tier
  // Fires once per normalized segment so the caller can surface a files-based
  // progress/ETA. done counts processed segments (success or skip); total is the
  // segment count.
  onProgress?: (done: number, total: number) => void;
}

export interface EditorStitchResult {
  videoBuffer: Buffer;
  thumbnailBuffer: Buffer;
  durationSeconds: number;
  skipped: { index: number; error: string }[];
}

const SAR = 48000;

// ffmpeg xfade transition names keyed by our friendly names.
const XFADE: Record<string, string> = {
  crossfade: "fade",
  fadeblack: "fadeblack",
  fadewhite: "fadewhite",
  dissolve: "dissolve",
  pixelize: "pixelize",
  wipe: "wiperight",
  wipeleft: "wipeleft",
  wipeup: "wipeup",
  wipedown: "wipedown",
  slide: "slideleft",
  slideright: "slideright",
  slideup: "slideup",
  slidedown: "slidedown",
  circle: "circleopen",
  circleclose: "circleclose",
  radial: "radial",
  zoomin: "zoomin",
};

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // -threads 2: caps ffmpeg worker threads to limit peak RAM (prevents OOM in production VMs).
    const p = spawn("ffmpeg", ["-threads", "2", ...args]);
    let stderr = "";
    p.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) return resolve();
      const reason =
        code === null
          ? "killed by OS (out-of-memory or SIGKILL — try a lower resolution)"
          : `exited ${code}`;
      reject(new Error(`ffmpeg ${reason}: ${stderr.slice(-500)}`));
    });
  });
}

function probeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      file,
    ]);
    let s = "";
    p.stdout.on("data", (d) => (s += d.toString()));
    p.on("error", () => resolve(0));
    p.on("close", () => resolve(parseFloat(s.trim()) || 0));
  });
}

function hasAudio(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      file,
    ]);
    let s = "";
    p.stdout.on("data", (d) => (s += d.toString()));
    p.on("error", () => resolve(false));
    p.on("close", () => resolve(s.trim().length > 0));
  });
}

export async function stitchEditorTimeline(
  input: EditorStitchInput,
): Promise<EditorStitchResult> {
  // Hard-cap at 720p — 1080p encoding exhausts RAM on the production VM.
  // Raise this limit only after upgrading the deployment to a higher-memory tier.
  const W = Math.min(input.width ?? 1280, 1280);
  const H = Math.min(input.height ?? 720, 720);
  const FPS = input.fps ?? 30;
  const vf =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;

  const dir = join(tmpdir(), `bv_editor_${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const skipped: { index: number; error: string }[] = [];

  try {
    // 1. Normalize each segment to a uniform mp4 (silent audio track guaranteed).
    const parts: string[] = [];
    for (let i = 0; i < input.segments.length; i++) {
      const seg = input.segments[i]!;
      const raw = join(dir, `raw_${i}.${seg.ext || (seg.kind === "photo" ? "jpg" : "mp4")}`);
      const out = join(dir, `seg_${String(i).padStart(4, "0")}.mp4`);
      try {
        await writeFile(raw, seg.buffer);
        if (seg.kind === "photo") {
          const dur = Math.max(0.5, seg.durationSec || 3);
          await run([
            "-y",
            "-loop", "1", "-t", String(dur), "-i", raw,
            "-f", "lavfi", "-t", String(dur), "-i",
            `anullsrc=channel_layout=stereo:sample_rate=${SAR}`,
            "-vf", vf,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
            "-refs", "1", "-bf", "0", "-threads", "2",
            "-pix_fmt", "yuv420p", "-r", String(FPS),
            "-c:a", "aac", "-ar", String(SAR), "-ac", "2",
            "-video_track_timescale", "30000",
            out,
          ]);
        } else {
          const audio = await hasAudio(raw);
          const args = ["-y", "-i", raw];
          if (!audio) {
            args.push("-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=${SAR}`);
          }
          args.push(
            "-vf", vf,
            "-map", "0:v:0", "-map", audio ? "0:a:0" : "1:a:0",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
            "-refs", "1", "-bf", "0", "-threads", "2",
            "-pix_fmt", "yuv420p", "-r", String(FPS),
            "-c:a", "aac", "-ar", String(SAR), "-ac", "2",
            "-shortest", "-video_track_timescale", "30000",
            out,
          );
          await run(args);
        }
        parts.push(out);
      } catch (err) {
        skipped.push({ index: i, error: String((err as Error).message || err).slice(-300) });
      }
      // Report after each segment (processed or skipped) so the caller can show
      // a files-remaining estimate.
      input.onProgress?.(i + 1, input.segments.length);
    }

    if (parts.length === 0) {
      throw new Error(`Every segment failed to process (${skipped.length} skipped).`);
    }

    // 2. Join — hard cut concat, or an xfade/acrossfade transition chain.
    const transType = input.transition?.type ?? "none";
    const xName = XFADE[transType];
    const joined = join(dir, "joined.mp4");

    if (xName && parts.length >= 2) {
      const durs: number[] = [];
      for (const p of parts) durs.push(await probeDuration(p));
      const minDur = Math.min(...durs);
      const t = Math.max(0.1, Math.min(input.transition?.durationSec || 0.5, minDur - 0.05, 2));
      // Join two clips at a time instead of one N-input filter graph — a single
      // graph buffers frames from every input at once and gets OOM-killed on
      // long timelines in production. Pairwise keeps peak memory flat.
      let acc = parts[0]!;
      let accDur = durs[0]!;
      for (let k = 1; k < parts.length; k++) {
        const step = join(dir, `join_${String(k).padStart(4, "0")}.mp4`);
        const offset = Math.max(0, accDur - t).toFixed(3);
        await run([
          "-y", "-i", acc, "-i", parts[k]!,
          "-filter_complex",
          `[0:v][1:v]xfade=transition=${xName}:duration=${t}:offset=${offset}[v];` +
            `[0:a][1:a]acrossfade=d=${t}[a]`,
          "-map", "[v]", "-map", "[a]",
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
          "-refs", "1", "-bf", "0", "-threads", "2",
          "-pix_fmt", "yuv420p", "-r", String(FPS),
          "-c:a", "aac", "-ar", String(SAR), "-ac", "2",
          // Keep the same track timescale as the normalized segments — xfade
          // refuses inputs whose video timebases differ.
          "-video_track_timescale", "30000",
          step,
        ]);
        acc = step;
        accDur = accDur + durs[k]! - t;
      }
      await run(["-y", "-i", acc, "-c", "copy", joined]);
    } else {
      const listFile = join(dir, "list.txt");
      await writeFile(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
      await run(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", joined]);
    }

    let current = joined;

    // 3. Music (mix with or replace clip audio).
    if (input.music) {
      const musicPath = join(dir, `music.${input.music.ext || "mp3"}`);
      await writeFile(musicPath, input.music.buffer);
      const vol = Math.max(0, Math.min(2, input.music.volume || 0.6));
      const withMusic = join(dir, "music.mp4");
      const args = ["-y", "-i", current, "-stream_loop", "-1", "-i", musicPath];
      if (input.music.mode === "replace") {
        args.push("-filter_complex", `[1:a]volume=${vol}[a]`, "-map", "0:v:0", "-map", "[a]");
      } else {
        args.push(
          "-filter_complex",
          `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`,
          "-map", "0:v:0", "-map", "[a]",
        );
      }
      args.push("-c:v", "copy", "-c:a", "aac", "-ar", String(SAR), "-ac", "2", "-shortest", withMusic);
      await run(args);
      current = withMusic;
    }

    // 4. Free-tier watermark (drawtext, bottom-right).
    if (input.watermark) {
      const wm = join(dir, "wm.mp4");
      const text = "AI Beat Sync";
      const draw =
        `drawtext=text='${text}':fontcolor=white@0.85:fontsize=${Math.round(H / 22)}:` +
        `box=1:boxcolor=black@0.35:boxborderw=8:x=w-text_w-24:y=h-text_h-24`;
      await run([
        "-y", "-i", current, "-vf", draw,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-refs", "1", "-bf", "0", "-threads", "2", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", wm,
      ]);
      current = wm;
    } else if (current === joined && !input.music) {
      // Ensure +faststart on the final file even with no music/watermark.
      const fast = join(dir, "final.mp4");
      await run(["-y", "-i", current, "-c", "copy", "-movflags", "+faststart", fast]);
      current = fast;
    }

    // 5. Thumbnail + read out.
    const durationSeconds = await probeDuration(current);
    const thumbPath = join(dir, "thumb.jpg");
    await run([
      "-y", "-ss", String(Math.max(0, durationSeconds * 0.3)), "-i", current,
      "-frames:v", "1",
      "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
      thumbPath,
    ]);

    const [videoBuffer, thumbnailBuffer] = await Promise.all([
      readFile(current),
      readFile(thumbPath),
    ]);
    return { videoBuffer, thumbnailBuffer, durationSeconds, skipped };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
