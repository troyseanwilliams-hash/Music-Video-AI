import { z } from "zod";

export const MAX_EDITOR_SECONDS = 1800;
const unit = z.number().finite().min(0).max(1);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const timing = {
  id: z.string().min(1).max(100),
  startSec: z.number().finite().min(0).max(MAX_EDITOR_SECONDS),
  durationSec: z.number().finite().positive().max(MAX_EDITOR_SECONDS),
};
export const VideoOverlaySchema = z.object({
  ...timing,
  kind: z.enum(["video", "image"]).optional(),
  name: z.string().min(1).max(120),
  objectPath: z.string().min(1),
  trimStart: z.number().finite().min(0).max(MAX_EDITOR_SECONDS).default(0),
  x: unit, y: unit,
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
  layout: z.enum(["custom", "reaction", "commentary"]),
  volume: unit.default(0),
  cornerRadius: z.number().finite().min(0).max(0.25).default(0),
  borderWidth: z.number().finite().min(0).max(0.02).default(0),
  borderColor: color.default("#ffffff"),
}).strict().superRefine((layer, ctx) => {
  if (layer.kind === "image" && (layer.trimStart !== 0 || layer.volume !== 0))
    ctx.addIssue({ code: "custom", message: "Static image overlays cannot have source trimming or audio." });
  if (layer.layout !== "commentary" && (layer.x + layer.width > 1.001 || layer.y + layer.height > 1.001))
    ctx.addIssue({ code: "custom", message: "Keep the complete overlay inside the frame." });
  if (layer.startSec + layer.durationSec > MAX_EDITOR_SECONDS)
    ctx.addIssue({ code: "custom", message: "Overlays must end within 30 minutes." });
});
export const TextCardSchema = z.object({
  ...timing,
  text: z.string().trim().min(1).max(500),
  x: unit, y: unit,
  fontSize: z.number().finite().min(0.01).max(0.15),
  color,
  backgroundColor: color,
}).strict();
export const AudioClipSchema = z.object({
  ...timing,
  name: z.string().min(1).max(120),
  objectPath: z.string().min(1),
  trimStart: z.number().finite().min(0).max(MAX_EDITOR_SECONDS),
  volume: unit,
  fadeInSec: z.number().finite().min(0).max(MAX_EDITOR_SECONDS).optional(),
  fadeOutSec: z.number().finite().min(0).max(MAX_EDITOR_SECONDS).optional(),
}).strict().refine((c) => (c.fadeInSec ?? 0) + (c.fadeOutSec ?? 0) <= c.durationSec,
  { message: "Music fades must fit within the clip duration." });
export const editorLayersShape = {
  audioClips: z.array(AudioClipSchema).max(100).optional(),
  overlays: z.array(VideoOverlaySchema).max(100).optional(),
  textCards: z.array(TextCardSchema).max(100).optional(),
};
export type VideoOverlay = z.infer<typeof VideoOverlaySchema>;
export type TextCard = z.infer<typeof TextCardSchema>;

export function validateEditorTiming(
  input: { segments: { kind: string; durationSec: number; trimStart?: number; trimEnd?: number }[];
    overlays?: VideoOverlay[]; textCards?: TextCard[]; audioClips?: z.infer<typeof AudioClipSchema>[] },
  ctx: z.RefinementCtx,
) {
  const total = input.segments.reduce((sum, s) => {
    if (s.kind !== "video") return sum + s.durationSec;
    const minimum = Math.min(0.3, s.durationSec);
    return sum + Math.max(minimum, s.durationSec - (s.trimStart ?? 0) - (s.trimEnd ?? 0));
  }, 0);
  if (total > MAX_EDITOR_SECONDS + 0.001)
    ctx.addIssue({ code: "custom", message: "Montage projects can be at most 30 minutes." });
  for (const layer of input.overlays ?? []) {
    const active = (input.overlays ?? []).filter((other) =>
      other.startSec <= layer.startSec && other.startSec + other.durationSec > layer.startSec);
    if (active.length > 4) {
      ctx.addIssue({ code: "custom", path: ["overlays"], message: "Use no more than four overlapping overlays at once." });
      break;
    }
  }
  for (const clip of input.audioClips ?? []) {
    const active = (input.audioClips ?? []).filter((other) =>
      other.startSec <= clip.startSec && other.startSec + other.durationSec > clip.startSec);
    if (active.length > 4) {
      ctx.addIssue({ code: "custom", path: ["audioClips"], message: "Use no more than four timed music clips at once." });
      break;
    }
  }
  for (const [kind, layers] of [["overlays", input.overlays], ["textCards", input.textCards], ["audioClips", input.audioClips]] as const) {
    for (const [index, layer] of (layers ?? []).entries()) {
      if (layer.startSec + layer.durationSec > total + 0.05)
        ctx.addIssue({ code: "custom", path: [kind, index], message: "Layers must fit within the main timeline." });
    }
  }
}
