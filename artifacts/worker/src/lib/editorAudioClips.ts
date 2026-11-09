import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

export interface EditorAudioClip {
  id: string; name: string; objectPath: string;
  startSec: number; durationSec: number; trimStart: number; volume: number;
}
export interface EditorAudioClipInput extends EditorAudioClip {
  buffer: Buffer; ext?: string;
}

/** Mix bounded audio windows, then copy the original video without re-encoding it. */
export async function renderEditorAudioClips(options: {
  current: string; dir: string; duration: number; clips: EditorAudioClipInput[];
  run: (args: string[]) => Promise<void>;
  hasAudio: (path: string) => Promise<boolean>;
  probeDuration: (path: string) => Promise<number>;
}): Promise<string> {
  const { current, dir, duration, clips, run } = options;
  if (!clips.length) return current;
  if (clips.length > 100 || !(duration > 0) || duration > 1800.1)
    throw new Error("Timed music supports up to 100 clips within a 30-minute timeline.");
  const sources: string[] = [];
  const boundaries = new Set([0, duration]);
  for (let t = 30; t < duration; t += 30) boundaries.add(t);
  for (const [i, clip] of clips.entries()) {
    if (![clip.startSec, clip.durationSec, clip.trimStart, clip.volume].every(Number.isFinite)
      || clip.startSec < 0 || clip.durationSec <= 0 || clip.trimStart < 0
      || clip.volume < 0 || clip.volume > 1 || clip.startSec + clip.durationSec > duration + 0.05)
      throw new Error("A timed music clip has invalid timing or volume. Adjust it before exporting.");
    const ext = clip.ext && /^[a-z0-9]{1,10}$/i.test(clip.ext) ? clip.ext : "mp3";
    const path = join(dir, `timed-music-${i}.${ext}`);
    await writeFile(path, clip.buffer);
    if (!await options.hasAudio(path)) throw new Error(`Music clip “${clip.name}” has no readable audio.`);
    const sourceDuration = await options.probeDuration(path);
    if (clip.trimStart + clip.durationSec > sourceDuration + 0.05)
      throw new Error(`Music clip “${clip.name}” is shorter than its selected time slot. Reduce its duration or source offset.`);
    sources.push(path);
    boundaries.add(Math.min(duration, clip.startSec));
    boundaries.add(Math.min(duration, clip.startSec + clip.durationSec));
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const chunks: string[] = [];
  for (let w = 0; w < points.length - 1; w++) {
    const start = points[w]!, end = points[w + 1]!, length = end - start;
    if (length < 0.000001) continue;
    const active = clips.map((clip, index) => ({ clip, index }))
      .filter(({ clip }) => clip.startSec < end - 0.000001 && clip.startSec + clip.durationSec > start + 0.000001);
    if (active.length > 4) throw new Error("Use no more than four timed music clips at once.");
    const args = ["-y", "-filter_complex_threads", "1", "-ss", String(start), "-i", current];
    const graph = [`[0:a]atrim=duration=${length},asetpts=PTS-STARTPTS,aresample=48000,apad,atrim=duration=${length}[base]`];
    const labels = ["[base]"];
    for (const [j, { clip, index }] of active.entries()) {
      args.push("-ss", String(clip.trimStart + start - clip.startSec), "-i", sources[index]!);
      graph.push(`[${j + 1}:a]atrim=duration=${length},asetpts=PTS-STARTPTS,aresample=48000,volume=${clip.volume},apad,atrim=duration=${length}[a${j}]`);
      labels.push(`[a${j}]`);
    }
    const mixed = active.length ? "mixed" : "base";
    if (active.length)
      graph.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0,alimiter=limit=0.98:level=0:latency=1[mixed]`);
    const path = join(dir, `music-window-${w}.flac`);
    args.push("-filter_complex", graph.join(";"), "-map", `[${mixed}]`, "-vn",
      "-t", String(length), "-ar", "48000", "-ac", "2", "-c:a", "flac", "-compression_level", "0", path);
    await run(args);
    chunks.push(path);
  }
  const list = join(dir, "music-windows.txt");
  await writeFile(list, chunks.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n"));
  const output = join(dir, "with-timed-music.mp4");
  await run(["-y", "-i", current, "-f", "concat", "-safe", "0", "-i", list,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
    "-ar", "48000", "-ac", "2", "-t", String(duration), "-movflags", "+faststart", output]);
  await Promise.all(chunks.map((path) => rm(path, { force: true })));
  return output;
}
