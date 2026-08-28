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
import { buildTimedLines, buildAssKaraoke, karaokeFontsDir } from "./lyricTiming.js";

// `:fontsdir=` option pointing libass at the bundled karaoke font (Archivo
// Black); empty string when the font directory is missing.
function fontsDirOpt(): string {
  const dir = karaokeFontsDir();
  return dir ? `:fontsdir=${dir.replace(/([\\':])/g, "\\$1")}` : "";
}

import { logger } from "./logger.js";

export interface EditorSegmentInput {
  buffer: Buffer;
  kind: "video" | "photo";
  durationSec: number; // for photos: how long to show; for videos: ignored (full clip)
  ext?: string; // source extension hint (e.g. "mp4", "jpg")
  trimStart?: number; // seconds to cut off the front of a video clip
  trimEnd?: number; // seconds to cut off the back of a video clip
}

export interface EditorMusicInput {
  buffer: Buffer;
  ext: string;
  mode: "mix" | "replace";
  volume: number; // 0..1
  loop?: boolean; // repeat a mixed track to fill the video (default true)
  fade?: boolean; // fade the music in at the start and out at the end
}

export interface EditorStitchInput {
  segments: EditorSegmentInput[];
  music?: EditorMusicInput;
  transition?: { type: string; durationSec: number }; // type "none" => hard cut
  width?: number;
  height?: number;
  fps?: number;
  watermark?: boolean; // free tier
  // Karaoke lyric burn (same engine as the generator): plain text, LRC line
  // timestamps, or word-level enhanced LRC. Skipped (non-fatal) if the local
  // ffmpeg lacks libass.
  lyricsText?: string;
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
  // True when a requested transition was dropped in favor of a hard-cut concat
  // because the timeline was too long (see TRANSITION_MAX_* below).
  transitionsDisabled: boolean;
  // Why, when transitionsDisabled is true — surfaced to the user on the
  // finished job so "my transition didn't work" has a real answer instead of
  // a silent hard cut. Undefined when transitions weren't requested at all.
  transitionDropReason?: string;
}

export function editorMusicTempPaths(dir: string, ext?: string): {
  inputPath: string;
  outputPath: string;
} {
  const normalizedExt =
    ext && /^[a-z0-9]{1,10}$/i.test(ext) ? ext.toLowerCase() : "mp3";
  return {
    inputPath: join(dir, `music-input.${normalizedExt}`),
    outputPath: join(dir, "with-music.mp4"),
  };
}

const SAR = 48000;

// Transitions use a segment-and-concat crossfade (see the join step below):
// each clip body is encoded once and only the short overlaps get an xfade, so
// cost is O(total duration) and memory stays flat. That lets long slideshows
// transition reliably, so the caps can be generous. Past either threshold we
// still fall back to a hard-cut concat as a safety valve. And if the crossfade
// errors for any reason, the render degrades to a hard cut rather than failing.
const TRANSITION_MAX_SEGMENTS = 60; // e.g. a 60-photo wedding slideshow
const TRANSITION_MAX_TOTAL_SEC = 600; // 10 minutes

// Friendly transition name -> ffmpeg xfade transition name. The efficient
// segment-and-concat join makes every one of these as cheap as a crossfade, so
// the full set is back. All names verified against ffmpeg 4.4 (production);
// anything not listed here falls through to a hard cut.
const XFADE: Record<string, string> = {
  crossfade: "fade",
  fadeblack: "fadeblack",
  fadewhite: "fadewhite",
  dissolve: "dissolve",
  pixelize: "pixelize",
  wipeleft: "wipeleft",
  wiperight: "wiperight",
  wipeup: "wipeup",
  wipedown: "wipedown",
  slideleft: "slideleft",
  slideright: "slideright",
  slideup: "slideup",
  slidedown: "slidedown",
  circleopen: "circleopen",
  circleclose: "circleclose",
  radial: "radial",
};

// Hard cap on any single ffmpeg invocation. A healthy step (normalizing one
// clip, one xfade join, music mix, watermark) finishes in well under this.
// Without it, a hung ffmpeg stalls the job forever with zero progress until
// the stale-job watchdog force-recovers it — a silent 60+ minute hang loop
// observed in production. Killing the process turns the hang into a real
// error that flows into the normal skip/retry/fail handling.
const FFMPEG_STEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // -threads 2: caps ffmpeg worker threads to limit peak RAM (prevents OOM in production VMs).
    const p = spawn("ffmpeg", ["-threads", "2", ...args]);
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, FFMPEG_STEP_TIMEOUT_MS);
    p.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    p.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return reject(
          new Error(
            `ffmpeg step timed out after ${FFMPEG_STEP_TIMEOUT_MS / 60000} minutes and was killed (file may be corrupt or too large to process)`,
          ),
        );
      }
      if (code === 0) return resolve();
      const reason =
        code === null
          ? "killed by OS (out-of-memory or SIGKILL — try a lower resolution)"
          : `exited ${code}`;
      reject(new Error(`ffmpeg ${reason}: ${stderr.slice(-500)}`));
    });
  });
}

// ffprobe should answer in seconds; kill it after a minute so a probe against
// a corrupt file can never hang the render.
const FFPROBE_TIMEOUT_MS = 60 * 1000;

function probeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      file,
    ]);
    const timer = setTimeout(() => p.kill("SIGKILL"), FFPROBE_TIMEOUT_MS);
    let s = "";
    p.stdout.on("data", (d) => (s += d.toString()));
    p.on("error", () => {
      clearTimeout(timer);
      resolve(0);
    });
    p.on("close", () => {
      clearTimeout(timer);
      resolve(parseFloat(s.trim()) || 0);
    });
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
    const timer = setTimeout(() => p.kill("SIGKILL"), FFPROBE_TIMEOUT_MS);
    let s = "";
    p.stdout.on("data", (d) => (s += d.toString()));
    p.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    p.on("close", () => {
      clearTimeout(timer);
      resolve(s.trim().length > 0);
    });
  });
}

export async function stitchEditorTimeline(
  input: EditorStitchInput,
): Promise<EditorStitchResult> {
  // Hard-cap total pixels at ~720p worth (1280×720) — 1080p encoding exhausts
  // RAM on the production VM — but preserve the requested aspect ratio so
  // portrait (9:16) renders as 720×1280, not a cropped landscape frame.
  const MAX_PIXELS = 1280 * 720;
  let W = input.width ?? 1280;
  let H = input.height ?? 720;
  if (W * H > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / (W * H));
    // Keep dimensions even (H.264 requirement).
    W = Math.round((W * scale) / 2) * 2;
    H = Math.round((H * scale) / 2) * 2;
  }
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
          // Optional front/back trim: -ss seeks past the front, -t caps the kept
          // duration (origDur − trimStart − trimEnd). Both re-encode below.
          const requestedTrimStart =
            typeof seg.trimStart === "number" && Number.isFinite(seg.trimStart)
              ? Math.max(0, seg.trimStart)
              : 0;
          const requestedTrimEnd =
            typeof seg.trimEnd === "number" && Number.isFinite(seg.trimEnd)
              ? Math.max(0, seg.trimEnd)
              : 0;
          let trimStart = requestedTrimStart;
          let trimEnd = requestedTrimEnd;
          let keepDur: number | null = null;
          if (requestedTrimStart > 0 || requestedTrimEnd > 0) {
            const origDur = await probeDuration(raw);
            if (!(origDur > 0)) throw new Error("Could not determine the source video duration for trimming.");
            const minimumKept = Math.min(0.3, origDur);
            const maximumTotalTrim = Math.max(0, origDur - minimumKept);
            trimStart = Math.min(requestedTrimStart, maximumTotalTrim);
            trimEnd = Math.min(requestedTrimEnd, Math.max(0, maximumTotalTrim - trimStart));
            keepDur = Math.max(minimumKept, origDur - trimStart - trimEnd);
          }
          const args = ["-y"];
          if (trimStart > 0) args.push("-ss", String(trimStart));
          args.push("-i", raw);
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
          );
          if (keepDur != null) args.push("-t", String(keepDur));
          args.push(out);
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

    // Decide whether transitions are safe for this timeline. A transition is
    // requested when xName is set and there are >=2 clips to blend.
    let useTransition = !!xName && parts.length >= 2;
    let transitionsDisabled = false;
    let transitionDropReason: string | undefined;

    // Requested a transition type we don't recognize (or "none"/single clip) —
    // not a failure, just nothing to blend.
    if (input.transition && input.transition.type !== "none" && !xName) {
      logger.warn({ transType }, "Unknown transition type requested — rendering as hard cut");
    }

    // Guard 1 (segment count): cheap, deterministic — no probing needed.
    if (useTransition && parts.length > TRANSITION_MAX_SEGMENTS) {
      useTransition = false;
      transitionsDisabled = true;
      transitionDropReason = `Your timeline has ${parts.length} clips, above the ${TRANSITION_MAX_SEGMENTS}-clip limit for transitions, so it was joined with hard cuts instead.`;
    }

    // Probe durations only if we still intend to transition — needed for the
    // xfade offsets and for the total-runtime guard below.
    let durs: number[] = [];
    if (useTransition) {
      for (const p of parts) durs.push(await probeDuration(p));
      const totalSec = durs.reduce((a, b) => a + b, 0);
      // Guard 2 (total runtime): very long timelines fall back to hard cuts.
      if (totalSec > TRANSITION_MAX_TOTAL_SEC) {
        useTransition = false;
        transitionsDisabled = true;
        transitionDropReason = `Your timeline is over ${Math.round(TRANSITION_MAX_TOTAL_SEC / 60)} minutes, above the length limit for transitions, so it was joined with hard cuts instead.`;
      }
    }

    // Hard-cut concat (fast, robust, flat memory) — the safety net for both the
    // "no transition" case and any crossfade failure.
    const hardCut = async () => {
      const listFile = join(dir, "list.txt");
      await writeFile(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
      await run(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", joined]);
    };

    if (useTransition) {
      // Segment-and-concat crossfade. Encode each clip's BODY once and give only
      // the short overlap between neighbours an xfade, then concat everything
      // with `-c copy`. Total encode work is O(sum of durations) — a single pass
      // — instead of the old accumulator that re-encoded the whole growing
      // timeline at every join (O(N^2), the cause of the timeouts/OOM/failures).
      // Peak memory stays flat because each ffmpeg step only touches 1–2 short
      // inputs. Validated to be frame-accurate and A/V-synced.
      const enc = [
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
        "-refs", "1", "-bf", "0", "-threads", "2",
        "-pix_fmt", "yuv420p", "-r", String(FPS),
        "-c:a", "aac", "-ar", String(SAR), "-ac", "2",
        // Keep a uniform track timescale so xfade + concat accept every piece.
        "-video_track_timescale", "30000",
      ];
      const fx = (n: number) => n.toFixed(3);
      const minDur = Math.min(...durs);
      // Clamp so even the shortest middle clip keeps a real body (it loses 2·t).
      const t = Math.max(0.1, Math.min(input.transition?.durationSec || 0.5, 2, (minDur - 0.1) / 2));
      try {
        const pieces: string[] = [];
        for (let i = 0; i < parts.length; i++) {
          const d = durs[i]!;
          const bstart = i === 0 ? 0 : t;
          const bend = i === parts.length - 1 ? d : d - t;
          const blen = bend - bstart;
          // Skip a body that would be shorter than a frame or two.
          if (blen > 0.05) {
            const body = join(dir, `body_${String(i).padStart(4, "0")}.mp4`);
            await run(["-y", "-ss", fx(bstart), "-i", parts[i]!, "-t", fx(blen), ...enc, body]);
            pieces.push(body);
          }
          if (i < parts.length - 1) {
            // Crossfade the last t of clip i with the first t of clip i+1.
            const tr = join(dir, `trans_${String(i).padStart(4, "0")}.mp4`);
            await run([
              "-y",
              "-ss", fx(d - t), "-i", parts[i]!, "-t", fx(t),
              "-ss", "0", "-i", parts[i + 1]!, "-t", fx(t),
              "-filter_complex",
              // Reset PTS and normalize the timebase on BOTH inputs before the
              // xfade/acrossfade. Because each input is produced with an -ss
              // seek, its timestamps don't start at 0, and many ffmpeg builds
              // then reject xfade ("do not match" / no output) — the exact cause
              // of the crossfade silently falling back to a hard cut in prod.
              // The settb reset also erases the input's constant-frame-rate
              // metadata (reports as 1/0), and ffmpeg 7.x's xfade — unlike 4.x —
              // hard-rejects a non-constant frame rate ("The inputs needs to be
              // a constant frame rate"), failing the encoder immediately and
              // triggering the hard-cut fallback below on every single export.
              // Re-stamping fps=FPS after the PTS reset restores a real frame
              // rate for xfade to key off. Order matters: fps must come AFTER
              // settb/setpts, not before, or the settb re-invalidates it.
              // apad+atrim on both audio branches: ffprobe's reported duration
              // for an AAC track can be a few ms longer than what's actually
              // decodable (encoder priming/padding), so seeking to
              // (bodyDuration - t) can leave acrossfade with slightly less
              // than t seconds of real audio. ffmpeg 4.x tolerated that
              // shortfall; ffmpeg 7.x's stricter scheduler treats "encoder
              // received zero frames before EOF" as a hard error, which is
              // what was silently killing the transition on every export in
              // production (which runs ffmpeg 7, not the 4.4 this was
              // originally verified against). Padding with silence first and
              // trimming to exactly t guarantees acrossfade always gets a
              // full window regardless of that precision gap.
              `[0:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS}[xv0];` +
                `[1:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS}[xv1];` +
                `[xv0][xv1]xfade=transition=${xName}:duration=${fx(t)}:offset=0[v];` +
                `[0:a]apad=pad_dur=1,atrim=duration=${fx(t)},asetpts=PTS-STARTPTS[xa0];` +
                `[1:a]apad=pad_dur=1,atrim=duration=${fx(t)},asetpts=PTS-STARTPTS[xa1];` +
                `[xa0][xa1]acrossfade=d=${fx(t)}[a]`,
              "-map", "[v]", "-map", "[a]", ...enc, tr,
            ]);
            pieces.push(tr);
          }
        }
        const listFile = join(dir, "xflist.txt");
        await writeFile(listFile, pieces.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
        await run(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", joined]);
      } catch (err) {
        // A transition hiccup must never fail the whole render — fall back to a
        // clean hard-cut concat and tell the caller transitions were dropped.
        // Log the real ffmpeg stderr (via err.message, set by run()) so a
        // "my transition didn't work" report is diagnosable instead of a guess,
        // and pass a reason through to the job so the user sees it too.
        logger.warn({ err, transType: xName }, "Crossfade join failed — falling back to hard-cut concat");
        transitionsDisabled = true;
        transitionDropReason = `The "${transType}" transition couldn't be applied to this export (an ffmpeg error), so clips were joined with a hard cut instead. Your credits/render were not affected — try again or pick a different transition.`;
        await hardCut();
      }
    } else {
      await hardCut();
    }

    let current = joined;

    // 3. Music. Mixed music can loop to fill the video. Replacement music is
    // always single-play: when it ends, the remaining footage intentionally
    // stays silent instead of repeating the selected track or restoring clip
    // audio. We hard-cap output to the probed video duration.
    if (input.music) {
      const videoDuration = await probeDuration(current);
      const { inputPath: musicPath, outputPath: withMusic } =
        editorMusicTempPaths(dir, input.music.ext);
      await writeFile(musicPath, input.music.buffer);
      const vol = Math.max(0, Math.min(2, input.music.volume || 0.6));
      const loop = input.music.mode === "mix" && input.music.loop !== false;

      // Optional fade in/out on the music (scaled down for very short videos so
      // the two fades never overlap).
      let fadeChain = "";
      if (input.music.fade && videoDuration > 0) {
        const fin = Math.min(1.5, videoDuration * 0.2);
        const fout = Math.min(2, videoDuration * 0.25);
        fadeChain = `,afade=t=in:st=0:d=${fin.toFixed(2)},afade=t=out:st=${Math.max(0, videoDuration - fout).toFixed(2)}:d=${fout.toFixed(2)}`;
      }
      const musicFilter = `volume=${vol}${fadeChain}`;

      // -stream_loop -1 (when looping) makes the music repeat. Replacement
      // audio instead plays once and is padded with silence through the full
      // stitched duration, so its stream cannot end early or reveal clip audio.
      // -t <videoDuration> trims the whole output to the video length.
      const args = ["-y", "-i", current];
      if (loop) args.push("-stream_loop", "-1");
      args.push("-i", musicPath);
      if (input.music.mode === "replace") {
        const replacementFilter = videoDuration > 0
          ? `[1:a]${musicFilter},apad=pad_dur=${videoDuration.toFixed(3)},atrim=duration=${videoDuration.toFixed(3)},asetpts=PTS-STARTPTS[a]`
          : `[1:a]${musicFilter}[a]`;
        args.push("-filter_complex", replacementFilter, "-map", "0:v:0", "-map", "[a]");
      } else {
        // duration=longest keeps the music going (looped or not); the -t cap
        // below ends the file at the video's end.
        args.push(
          "-filter_complex",
          `[1:a]${musicFilter}[m];[0:a][m]amix=inputs=2:duration=longest:dropout_transition=0[a]`,
          "-map", "0:v:0", "-map", "[a]",
        );
      }
      args.push("-c:v", "copy", "-c:a", "aac", "-ar", String(SAR), "-ac", "2");
      if (videoDuration > 0) args.push("-t", videoDuration.toFixed(3));
      else args.push("-shortest");
      args.push(withMusic);
      await run(args);
      current = withMusic;
    }

    // 4. Free-tier watermark (drawtext, bottom-right).
    if (input.watermark) {
      const wm = join(dir, "wm.mp4");
      const text = "Made with AIBeatSync · aibeatsync.com";
      const draw =
        `drawtext=text='${text}':fontcolor=white@0.85:fontsize=${Math.round(H / 28)}:` +
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

    // 4.5. Karaoke lyric burn (ASS subtitles via libass). Non-fatal: if the
    // subtitles filter is unavailable, the render ships without lyrics rather
    // than failing the whole export.
    if (input.lyricsText?.trim()) {
      try {
        const lyricDuration = await probeDuration(current);
        const timedLines = buildTimedLines(input.lyricsText, lyricDuration);
        if (timedLines.length > 0) {
          const assPath = join(dir, "lyrics.ass");
          await writeFile(assPath, buildAssKaraoke(timedLines));
          const withLyrics = join(dir, "lyrics.mp4");
          await run([
            "-y", "-i", current,
            "-vf", `subtitles=${assPath.replace(/([\\':])/g, "\\$1")}${fontsDirOpt()}`,
            "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-threads", "2", "-pix_fmt", "yuv420p",
            "-c:a", "copy", "-movflags", "+faststart", withLyrics,
          ]);
          current = withLyrics;
        }
      } catch {
        // libass missing or burn failed — continue without lyrics.
      }
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
    return { videoBuffer, thumbnailBuffer, durationSeconds, skipped, transitionsDisabled, transitionDropReason };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
