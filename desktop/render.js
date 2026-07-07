// render.js — FFmpeg pipeline: normalize clips/photos to a common format,
// concatenate them, then mix or replace audio with a music track.
import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);

// Resolve an ffmpeg/ffprobe binary in priority order:
//   1. env var (set by the desktop build) — only if the file actually exists
//   2. the bundled ffmpeg-static / ffprobe-static package
//   3. "ffmpeg" / "ffprobe" on the system PATH
function tryStatic(mod, pick) {
  try {
    const p = pick(require(mod));
    return p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}
function resolveBin(envVar, mod, pick, fallback) {
  const env = process.env[envVar];
  if (env && existsSync(env)) return env;
  return tryStatic(mod, pick) || fallback;
}

const FFMPEG = resolveBin(
  "FFMPEG_PATH",
  "ffmpeg-static",
  (m) => (typeof m === "string" ? m : m.default),
  "ffmpeg"
);
const FFPROBE = resolveBin(
  "FFPROBE_PATH",
  "ffprobe-static",
  (m) => m.path || (m.default && m.default.path),
  "ffprobe"
);

// Exposed so the app can report which binaries it resolved (see /api/health).
export function binaryInfo() {
  return {
    ffmpeg: FFMPEG,
    ffmpegExists: FFMPEG === "ffmpeg" ? false : existsSync(FFMPEG),
    ffprobe: FFPROBE,
    ffprobeExists: FFPROBE === "ffprobe" ? false : existsSync(FFPROBE),
  };
}

console.log(`[splicer] ffmpeg: ${FFMPEG}`);
console.log(`[splicer] ffprobe: ${FFPROBE}`);

// Target output format. Every segment is normalized to these so concat is lossless.
const W = 1280;
const H = 720;
const FPS = 30;
const SAR = 48000; // audio sample rate

// Kill a command if it produces no output for this long (a stuck/looping
// ffmpeg on a bad input). Legit work keeps emitting progress, so this only
// fires on genuine stalls — not on slow-but-active renders.
const STALL_MS = 60 * 1000;

// Run a command, resolve on exit 0, reject otherwise (incl. spawn error / stall).
function run(cmd, args, onLog) {
  return new Promise((resolve, reject) => {
    if (onLog) onLog(`$ ${cmd} ${args.join(" ")}\n`);
    const p = spawn(cmd, args);
    let stderr = "";
    let done = false;

    // Stall watchdog: reset on every chunk of output.
    let timer = null;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (done) return;
        if (onLog) onLog(`[stall] no output for ${STALL_MS / 1000}s — killing\n`);
        try { p.kill("SIGKILL"); } catch {}
        reject(new Error(`${cmd} stalled and was killed`));
      }, STALL_MS);
    };
    arm();

    p.stderr.on("data", (d) => {
      // Keep only the tail so a spammy process can't exhaust memory.
      stderr = (stderr + d.toString()).slice(-16000);
      if (onLog) onLog(d.toString());
      arm();
    });
    p.on("error", (err) => {
      done = true; clearTimeout(timer);
      if (onLog) onLog(`[spawn error] ${err.message}\n`);
      reject(err);
    });
    p.on("close", (code) => {
      done = true; clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

// True if the file has at least one audio stream.
async function hasAudio(file) {
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(FFPROBE, [
        "-v", "error",
        "-select_streams", "a",
        "-show_entries", "stream=codec_type",
        "-of", "csv=p=0",
        file,
      ]);
      let s = "";
      p.stdout.on("data", (d) => (s += d.toString()));
      p.on("error", reject);
      p.on("close", () => resolve(s));
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

// Exact duration (seconds) of a media file, via ffprobe.
async function getDuration(file) {
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
      let s = "";
      p.stdout.on("data", (d) => (s += d.toString()));
      p.on("error", reject);
      p.on("close", () => resolve(s));
    });
    return parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}

// Map a friendly transition name to an ffmpeg xfade transition. Only the simple
// crossfade is offered now; any other/legacy value falls through to a hard cut.
const XFADE = {
  crossfade: "fade",
};

const VF = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;

// Build a lightweight, browser-playable preview proxy (H.264/AAC, downscaled).
// Used so previews work for any source codec the bundled ffmpeg can decode,
// including HEVC/H.265 that Chromium can't play. The original file is untouched
// and is what gets used for the final export.
export async function makePreview(input, output, onLog) {
  const audio = await hasAudio(input);
  const args = ["-y", "-i", input];
  if (!audio) {
    args.push("-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=${SAR}`);
  }
  args.push(
    // Small + cheap: 480px wide, 24fps, ultrafast. It's only for in-app preview.
    "-vf", "scale='min(480,iw)':-2,fps=24",
    "-map", "0:v:0",
    "-map", audio ? "0:a:0" : "1:a:0",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k",
    "-shortest",
    output
  );
  await run(FFMPEG, args, onLog);
  return output;
}

// Normalize a single video segment to a standalone mp4 (guarantees an audio track).
async function normalizeVideo(input, output, onLog) {
  const audio = await hasAudio(input);
  const args = ["-y"];
  if (audio) {
    args.push("-i", input);
  } else {
    args.push(
      "-i", input,
      "-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=${SAR}`
    );
  }
  args.push(
    "-vf", VF,
    "-map", "0:v:0",
    "-map", audio ? "0:a:0" : "1:a:0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-ar", String(SAR), "-ac", "2",
    "-shortest",
    "-video_track_timescale", "30000",
    output
  );
  await run(FFMPEG, args, onLog);
}

// Normalize a photo into a still-image video segment of the given duration.
// The photo is shown at full size filling the frame: the whole image is kept
// (scaled to fit), and the leftover space is filled with a blurred, zoomed copy
// of the same photo instead of black bars — so nothing is cropped.
async function normalizePhoto(input, output, duration, onLog) {
  const dur = Math.max(0.1, Number(duration) || 3);
  const photoFilter =
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=20,setsar=1[bgb];` +
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fgs];` +
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,format=yuv420p,fps=${FPS}[v]`;
  const args = [
    "-y",
    "-loop", "1", "-t", String(dur), "-i", input,
    "-f", "lavfi", "-t", String(dur), "-i",
    `anullsrc=channel_layout=stereo:sample_rate=${SAR}`,
    "-filter_complex", photoFilter,
    "-map", "[v]", "-map", "1:a:0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-ar", String(SAR), "-ac", "2",
    "-video_track_timescale", "30000",
    output,
  ];
  await run(FFMPEG, args, onLog);
}

// Cap how many clips are fed to a single xfade filtergraph. Each input opens
// its own decoder; feeding hundreds at once exhausts the OS thread/descriptor
// limit and ffmpeg fails with "Resource temporarily unavailable". Large
// timelines are merged in bounded batches instead (see xfadeMerge).
const XFADE_MAX_INPUTS = 12;

// xfade a single batch of parts (<= XFADE_MAX_INPUTS) into one file, placing the
// crossfades at the right cumulative offsets. Audio is acrossfade-d in step.
async function xfadeGroup(group, xName, transitionDuration, outPath, onLog) {
  const durs = [];
  for (const p of group) durs.push(await getDuration(p));
  const minDur = Math.min(...durs);
  const t = Math.max(0.1, Math.min(Number(transitionDuration) || 0.5, minDur - 0.05, 2));

  const filters = [];
  let prevV = "0:v", prevA = "0:a", cum = durs[0];
  for (let k = 1; k < group.length; k++) {
    const offset = Math.max(0, cum - t).toFixed(3);
    const vO = `v${k}`, aO = `a${k}`;
    filters.push(`[${prevV}][${k}:v]xfade=transition=${xName}:duration=${t}:offset=${offset}[${vO}]`);
    filters.push(`[${prevA}][${k}:a]acrossfade=d=${t}[${aO}]`);
    prevV = vO; prevA = aO;
    cum = cum + durs[k] - t;
  }

  const args = ["-y"];
  for (const p of group) args.push("-i", p);
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", `[${prevV}]`, "-map", `[${prevA}]`,
    "-threads", "2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-ar", String(SAR), "-ac", "2",
    outPath
  );
  await run(FFMPEG, args, onLog);
}

// Merge any number of parts with transitions, in bounded batches. Parts are
// xfaded in groups of XFADE_MAX_INPUTS into intermediates, then those
// intermediates are themselves xfaded together — repeating until one file
// remains. This keeps every transition (including across batch boundaries)
// while never opening more than XFADE_MAX_INPUTS decoders at once. Returns the
// path to the merged file.
async function xfadeMerge(parts, xName, transitionDuration, work, onLog) {
  let current = parts;
  let level = 0;
  while (current.length > 1) {
    const next = [];
    for (let start = 0; start < current.length; start += XFADE_MAX_INPUTS) {
      const group = current.slice(start, start + XFADE_MAX_INPUTS);
      if (group.length === 1) { next.push(group[0]); continue; }
      const out = path.join(work, `xfade-l${level}-${next.length}.mp4`);
      await xfadeGroup(group, xName, transitionDuration, out, onLog);
      next.push(out);
    }
    current = next;
    level++;
  }
  return current[0];
}

/**
 * Render a final MP4.
 * @param {Array<{type:'video'|'photo', path:string, duration?:number}>} segments ordered
 * @param {object} opts
 * @param {string} [opts.musicPath] optional background music file
 * @param {'mix'|'replace'} [opts.musicMode='mix']
 * @param {number} [opts.musicVolume=0.6] 0..1
 * @param {string} opts.outPath where to write the final mp4
 * @param {(s:string)=>void} [opts.onLog]
 * @param {(p:{phase:'normalize'|'join'|'music', done:number, total:number})=>void} [opts.onProgress]
 *        Progress callback. During "normalize" it fires once per processed file
 *        so the caller can compute a files-remaining ETA.
 */
export async function renderVideo(segments, opts) {
  const {
    musicPath, musicMode = "mix", musicVolume = 0.6, outPath, onLog, onProgress,
    transition = "none", transitionDuration = 0.5,
  } = opts;
  if (!segments || segments.length === 0) throw new Error("No segments to render.");
  const report = (phase, done, total) => {
    if (onProgress) { try { onProgress({ phase, done, total }); } catch {} }
  };

  const work = await fs.mkdtemp(path.join(os.tmpdir(), "splicer-"));
  const skipped = []; // files that failed to process and were left out
  try {
    // 1. Normalize every segment. If one fails, skip it and keep going so a
    //    single bad file doesn't sink the whole export.
    const parts = [];
    const total = segments.length;
    report("normalize", 0, total);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const part = path.join(work, `seg-${String(i).padStart(4, "0")}.mp4`);
      try {
        if (seg.type === "photo") {
          await normalizePhoto(seg.path, part, seg.duration, onLog);
        } else {
          await normalizeVideo(seg.path, part, onLog);
        }
        parts.push(part);
      } catch (err) {
        const name = seg.name || path.basename(seg.path);
        const msg = String(err.message || err);
        if (onLog) onLog(`[skip] ${seg.type} "${name}" failed, skipping: ${msg.slice(0, 200)}\n`);
        skipped.push({ index: i, name, type: seg.type, error: msg.slice(-300) });
      }
      // Report after each file (processed or skipped) so the ETA reflects the
      // true number of files left to handle.
      report("normalize", i + 1, total);
    }

    if (parts.length === 0) {
      throw new Error(
        `Every file failed to process, so there is nothing to export (${skipped.length} skipped).`
      );
    }

    // 2. Join the parts — either a hard-cut concat (fast, lossless) or, if a
    //    transition is chosen, an xfade/acrossfade chain (re-encodes).
    report("join", parts.length, parts.length);
    const concatPath = musicPath ? path.join(work, "concat.mp4") : outPath;
    const xName = XFADE[transition];

    if (xName && parts.length >= 2) {
      if (parts.length <= XFADE_MAX_INPUTS) {
        // Small timeline: a single xfade pass straight to the output.
        await xfadeGroup(parts, xName, transitionDuration, concatPath, onLog);
      } else {
        // Large timeline: merge in bounded batches so we never open hundreds of
        // decoders at once, then copy the merged result into place.
        if (onLog) onLog(`[xfade] ${parts.length} clips — merging in batches of ${XFADE_MAX_INPUTS}\n`);
        const merged = await xfadeMerge(parts, xName, transitionDuration, work, onLog);
        await fs.copyFile(merged, concatPath);
      }
    } else {
      // Hard cut: lossless stream copy, since all parts share a format.
      const listFile = path.join(work, "list.txt");
      await fs.writeFile(
        listFile,
        parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
      );
      await run(
        FFMPEG,
        ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", concatPath],
        onLog
      );
    }

    // 3. Apply music if provided.
    if (musicPath) {
      report("music", parts.length, parts.length);
      const vol = Math.max(0, Math.min(2, Number(musicVolume) || 0.6));
      const args = [
        "-y",
        "-i", concatPath,
        "-stream_loop", "-1", "-i", musicPath,
      ];
      if (musicMode === "replace") {
        args.push(
          "-filter_complex", `[1:a]volume=${vol}[a]`,
          "-map", "0:v:0", "-map", "[a]"
        );
      } else {
        args.push(
          "-filter_complex",
          `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`,
          "-map", "0:v:0", "-map", "[a]"
        );
      }
      args.push(
        "-c:v", "copy",
        "-c:a", "aac", "-ar", String(SAR), "-ac", "2",
        "-shortest",
        outPath
      );
      await run(FFMPEG, args, onLog);
    }

    if (skipped.length && onLog) {
      onLog(`--- finished with ${skipped.length} file(s) skipped ---\n`);
    }
    return { outPath, skipped };
  } finally {
    fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
