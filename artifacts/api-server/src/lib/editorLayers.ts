import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

export interface EditorVideoOverlay {
  kind?: "video" | "image";
  id: string; name: string; objectPath: string;
  startSec: number; durationSec: number; trimStart: number;
  x: number; y: number; width: number; height: number;
  layout: "custom" | "reaction" | "commentary";
  volume: number; cornerRadius: number; borderWidth: number; borderColor: string;
}
export interface EditorTextCard {
  id: string; text: string; startSec: number; durationSec: number;
  x: number; y: number; fontSize: number; color: string; backgroundColor: string;
}
export interface EditorOverlayInput extends EditorVideoOverlay {
  buffer: Buffer; ext?: string;
}

export function layerChunkBoundaries(duration: number, overlays: EditorVideoOverlay[], cards: EditorTextCard[]) {
  const points = new Set([0, duration]);
  for (let t = 30; t < duration; t += 30) points.add(t);
  for (const layer of [...overlays, ...cards]) {
    points.add(Math.max(0, Math.min(duration, layer.startSec)));
    points.add(Math.max(0, Math.min(duration, layer.startSec + layer.durationSec)));
  }
  return [...points].sort((a, b) => a - b);
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const n = (value: number) => value.toFixed(6);
const escapePath = (path: string) => path.replace(/([\\':])/g, "\\$1");

/**
 * Render bounded windows with only the active overlay inputs. Peak decoded-frame
 * memory depends on simultaneous layers, not on the number/length of the episode.
 * Source bytes are written once, and each completed window is concatenated by
 * stream copy. Missing/short overlay sources fail rather than silently disappearing.
 */
export async function renderEditorLayers(options: {
  current: string; dir: string; width: number; height: number; fps: number;
  duration: number; overlays: EditorOverlayInput[]; textCards: EditorTextCard[];
  run: (args: string[]) => Promise<void>;
  hasAudio: (file: string) => Promise<boolean>;
  probeDuration: (file: string) => Promise<number>;
  onProgress?: (done: number, total: number) => void;
}): Promise<string> {
  const { current, dir, width: W, height: H, fps, duration, overlays, textCards, run } = options;
  if (!(duration > 0) || duration > 1800.1) throw new Error("Montage projects can be at most 30 minutes.");
  const sources: { path: string; audio: boolean }[] = [];
  for (const [i, overlay] of overlays.entries()) {
    const ext = overlay.ext && /^[a-z0-9]{1,10}$/i.test(overlay.ext) ? overlay.ext : "mp4";
    let path = join(dir, `overlay-source-${i}.${ext}`);
    await writeFile(path, overlay.buffer);
    if (overlay.kind === "image") {
      // Decode once to a bounded, static PNG. This also rejects corrupt images
      // and avoids relying on a filename extension or image duration metadata.
      const decoded = join(dir, `overlay-image-${i}.png`);
      await run(["-y", "-threads", "2", "-filter_threads", "1", "-i", path,
        "-frames:v", "1", "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
        "-threads", "2", decoded]);
      path = decoded;
    } else {
      const sourceDuration = await options.probeDuration(path);
      if (overlay.trimStart + overlay.durationSec > sourceDuration + 0.1)
        throw new Error(`Overlay “${overlay.name}” is shorter than its selected duration. Trim or shorten the overlay.`);
    }
    if (overlay.startSec + overlay.durationSec > duration + 0.1)
      throw new Error("An overlay extends past the rendered main timeline. Restore missing clips or shorten the overlay.");
    sources.push({ path, audio: overlay.kind !== "image" && await options.hasAudio(path) });
  }
  for (const [i, card] of textCards.entries()) {
    if (card.startSec + card.durationSec > duration + 0.1)
      throw new Error("A text card extends past the rendered main timeline.");
    // textfile + expansion=none means quotes, percent signs, colons and filter
    // syntax in user-authored text cannot alter the filter graph.
    await writeFile(join(dir, `card-${i}.txt`), card.text);
  }
  const boundaries = layerChunkBoundaries(duration, overlays, textCards);
  const chunks: string[] = [];
  for (let window = 0; window < boundaries.length - 1; window++) {
    const start = boundaries[window]!;
    const end = boundaries[window + 1]!;
    const length = end - start;
    if (length < 0.000001) continue;
    const active = overlays.map((layer, index) => ({ layer, index }))
      .filter(({ layer }) => layer.startSec < end - 0.000001 && layer.startSec + layer.durationSec > start + 0.000001);
    // Guard resource use even for saved manifests authored by an older client.
    if (active.length > 4) throw new Error("Use no more than four overlapping overlays at once.");
    const args = ["-y", "-filter_complex_threads", "1", "-ss", n(start), "-i", current];
    for (const { layer, index } of active) {
      if (layer.kind === "image")
        args.push("-threads", "2", "-loop", "1", "-framerate", String(fps), "-i", sources[index]!.path);
      else
        args.push("-threads", "2", "-ss", n(layer.trimStart + start - layer.startSec), "-i", sources[index]!.path);
    }
    const graph = [
      `[0:v]trim=duration=${n(length)},setpts=PTS-STARTPTS,fps=${fps},setsar=1[v0]`,
      `[0:a]atrim=duration=${n(length)},asetpts=PTS-STARTPTS,apad,atrim=duration=${n(length)}[a0]`,
    ];
    let video = "v0";
    const audios = ["[a0]"];
    for (const [j, { layer, index }] of active.entries()) {
      const input = j + 1;
      const next = `v${j + 1}`;
      const source = `s${j}`;
      graph.push(`[${input}:v]trim=duration=${n(length)},setpts=PTS-STARTPTS,fps=${fps},setsar=1[${source}]`);
      if (layer.layout === "commentary") {
        graph.push(`[${source}]split=2[bg${j}][fg${j}]`);
        graph.push(`[bg${j}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2[blur${j}]`);
        graph.push(`[fg${j}]scale=${W}:${H}:force_original_aspect_ratio=decrease[fit${j}]`);
        graph.push(`[blur${j}][fit${j}]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1[full${j}]`);
        graph.push(`[${video}][full${j}]overlay=0:0:eof_action=pass[${next}]`);
      } else {
        const w = Math.min(W, even(layer.width * W));
        const h = Math.min(H, even(layer.height * H));
        const x = Math.min(W - w, Math.round(layer.x * W));
        const y = Math.min(H - h, Math.round(layer.y * H));
        const border = Math.round(layer.borderWidth * H);
        const radius = Math.min(w / 2, h / 2, Math.round(layer.cornerRadius * H));
        let filter = `scale=${w}:${h}:force_original_aspect_ratio=decrease,format=rgba,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
        if (border > 0) filter += `,drawbox=x=0:y=0:w=iw:h=ih:color=${layer.borderColor}:t=${border}`;
        if (radius > 0) {
          // Rounded rectangle alpha mask. A(X,Y) preserves contain-padding alpha.
          filter += `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(max(abs(X-W/2)-(W/2-${radius}),0),2)+pow(max(abs(Y-H/2)-(H/2-${radius}),0),2),${radius * radius}),alpha(X,Y),0)'`;
        }
        graph.push(`[${source}]${filter}[box${j}]`);
        graph.push(`[${video}][box${j}]overlay=${x}:${y}:eof_action=pass[${next}]`);
      }
      video = next;
      if (layer.volume > 0 && sources[index]!.audio) {
        const label = `oa${j}`;
        graph.push(`[${input}:a]atrim=duration=${n(length)},asetpts=PTS-STARTPTS,volume=${layer.volume},apad,atrim=duration=${n(length)}[${label}]`);
        audios.push(`[${label}]`);
      }
    }
    for (const [i, card] of textCards.entries()) {
      if (card.startSec >= end - 0.000001 || card.startSec + card.durationSec <= start + 0.000001) continue;
      const label = `text${i}`;
      graph.push(`[${video}]drawtext=textfile='${escapePath(join(dir, `card-${i}.txt`))}':expansion=none:fontcolor=${card.color}:fontsize=${Math.max(1, Math.round(card.fontSize * H))}:box=1:boxcolor=${card.backgroundColor}:boxborderw=8:x=${Math.round(card.x * W)}:y=${Math.round(card.y * H)}:fix_bounds=1[${label}]`);
      video = label;
    }
    // normalize=0 preserves main voice gain when a quiet overlay is added.
    const audio = audios.length > 1 ? "mixed" : "a0";
    if (audios.length > 1)
      graph.push(`${audios.join("")}amix=inputs=${audios.length}:duration=first:normalize=0,alimiter=limit=0.98:level=0:latency=1[${audio}]`);
    const output = join(dir, `layer-window-${window}.mp4`);
    args.push("-filter_complex", graph.join(";"), "-map", `[${video}]`, "-map", `[${audio}]`,
      "-t", n(length), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
      "-refs", "1", "-bf", "0", "-threads", "2", "-pix_fmt", "yuv420p",
      "-r", String(fps), "-video_track_timescale", "30000",
      "-c:a", "aac", "-ar", "48000", "-ac", "2", output);
    await run(args);
    chunks.push(output);
    options.onProgress?.(window + 1, boundaries.length - 1);
  }
  const list = join(dir, "layer-windows.txt");
  await writeFile(list, chunks.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n"));
  const output = join(dir, "with-layers.mp4");
  await run(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-t", n(duration), "-movflags", "+faststart", output]);
  await Promise.all(chunks.map((path) => rm(path, { force: true })));
  return output;
}
