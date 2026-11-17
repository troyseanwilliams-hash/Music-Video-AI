export const MAX_TIMELINE_SEC = 1800;
export const MAX_OVERLAYS = 100;
export const MAX_TEXT_CARDS = 100;
export const MAX_TEXT_LENGTH = 500;

export type OverlayLayout = "custom" | "reaction" | "commentary" | "center16x9";

export type OverlayKind = "video" | "image";

/** Image overlay MIME types accepted for upload. */
export const IMAGE_OVERLAY_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export interface VideoOverlay {
  id: string;
  /** Omitted means "video" (legacy manifests). Images hold a still for durationSec. */
  kind?: OverlayKind;
  name: string;
  objectPath: string;
  startSec: number;
  durationSec: number;
  trimStart: number;
  x: number;
  y: number;
  width: number;
  height: number;
  layout: OverlayLayout;
  volume: number;
  cornerRadius: number;
  borderWidth: number;
  borderColor: string;
}

export interface TextCard {
  id: string;
  text: string;
  startSec: number;
  durationSec: number;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  backgroundColor: string;
}

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function overlayId() {
  return "ov_" + Math.random().toString(36).slice(2, 10);
}

export function storageUrl(objectPath: string) {
  return `/api/storage${objectPath}`;
}

export const LAYOUT_PRESETS: Record<"reactionRight" | "reactionLeft" | "commentary", Pick<VideoOverlay, "x" | "y" | "width" | "height" | "layout" | "cornerRadius">> = {
  reactionRight: { x: 0.64, y: 0.05, width: 0.33, height: 0.5, layout: "reaction", cornerRadius: 0 },
  reactionLeft: { x: 0.03, y: 0.05, width: 0.33, height: 0.5, layout: "reaction", cornerRadius: 0 },
  commentary: { x: 0, y: 0, width: 1, height: 1, layout: "commentary", cornerRadius: 0 },
};

export const OVERLAY_BORDER_PRESETS = [
  { name: "None", color: "#ffffff", width: 0 },
  { name: "White", color: "#ffffff", width: 0.003 },
  { name: "Gold", color: "#f5c451", width: 0.003 },
  { name: "Violet", color: "#a855f7", width: 0.003 },
  { name: "Cyan", color: "#22d3ee", width: 0.003 },
] as const;

export function normalizeOverlay(raw: unknown): VideoOverlay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.objectPath !== "string" || !o.objectPath) return null;
  const width = clamp(num(o.width, 0.33), 0.05, 1);
  const height = clamp(num(o.height, 0.5), 0.05, 1);
  const layout: OverlayLayout = o.layout === "reaction" || o.layout === "commentary" || o.layout === "center16x9" ? o.layout : "custom";
  const isImage = o.kind === "image";
  return {
    ...(isImage ? { kind: "image" as const } : {}),
    id: typeof o.id === "string" && o.id ? o.id : overlayId(),
    name: typeof o.name === "string" ? o.name : "Overlay clip",
    objectPath: o.objectPath,
    startSec: clamp(num(o.startSec, 0), 0, MAX_TIMELINE_SEC),
    durationSec: clamp(num(o.durationSec, 5), 0.3, MAX_TIMELINE_SEC),
    trimStart: isImage ? 0 : clamp(num(o.trimStart, 0), 0, MAX_TIMELINE_SEC),
    x: clamp(num(o.x, 0), 0, 1 - width),
    y: clamp(num(o.y, 0), 0, 1 - height),
    width,
    height,
    layout,
    volume: isImage ? 0 : clamp(num(o.volume, 0.25), 0, 1),
    cornerRadius: clamp(num(o.cornerRadius, 0), 0, 0.25),
    borderWidth: clamp(num(o.borderWidth, 0), 0, 0.02),
    borderColor: hex(o.borderColor, "#ffffff"),
  };
}

export function normalizeTextCard(raw: unknown): TextCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.text !== "string") return null;
  return {
    id: typeof o.id === "string" && o.id ? o.id : overlayId(),
    text: o.text,
    startSec: clamp(num(o.startSec, 0), 0, MAX_TIMELINE_SEC),
    durationSec: clamp(num(o.durationSec, 4), 0.3, MAX_TIMELINE_SEC),
    x: clamp(num(o.x, 0.05), 0, 0.98),
    y: clamp(num(o.y, 0.75), 0, 0.98),
    fontSize: clamp(num(o.fontSize, 0.06), 0.01, 0.15),
    color: hex(o.color, "#ffffff"),
    backgroundColor: hex(o.backgroundColor, "#111111"),
  };
}

export function normalizeOverlayList(raw: unknown): VideoOverlay[] {
  return Array.isArray(raw) ? raw.map(normalizeOverlay).filter((o): o is VideoOverlay => !!o) : [];
}

export function normalizeTextCardList(raw: unknown): TextCard[] {
  return Array.isArray(raw) ? raw.map(normalizeTextCard).filter((o): o is TextCard => !!o) : [];
}

export const isImageOverlay = (o: Pick<VideoOverlay, "kind">) => o.kind === "image";

export function isActiveAt(item: { startSec: number; durationSec: number }, t: number) {
  return t >= item.startSec && t < item.startSec + item.durationSec;
}

export const END_TOLERANCE_SEC = 0.05;
export const MAX_SIMULTANEOUS_OVERLAYS = 4;

export interface LayerIssue {
  id: string | null;
  message: string;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;

// Mirrors the server's render/save validation so invalid timing is blocked in
// the editor instead of failing on submit. Nothing is truncated silently.
export function validateLayers(overlays: VideoOverlay[], textCards: TextCard[], totalSec: number): LayerIssue[] {
  const issues: LayerIssue[] = [];
  if (overlays.length > MAX_OVERLAYS) issues.push({ id: null, message: `${overlays.length} overlays — the limit is ${MAX_OVERLAYS}. Remove ${overlays.length - MAX_OVERLAYS}.` });
  if (textCards.length > MAX_TEXT_CARDS) issues.push({ id: null, message: `${textCards.length} text cards — the limit is ${MAX_TEXT_CARDS}. Remove ${textCards.length - MAX_TEXT_CARDS}.` });
  const limit = totalSec + END_TOLERANCE_SEC;
  overlays.forEach((o, i) => {
    const end = o.startSec + o.durationSec;
    if (end > limit) issues.push({ id: o.id, message: `Overlay ${i + 1} ("${o.name}") ends at ${fmt(end)}, after the main video ends at ${fmt(totalSec)}.` });
  });
  textCards.forEach((t, i) => {
    const end = t.startSec + t.durationSec;
    if (end > limit) issues.push({ id: t.id, message: `Text card ${i + 1} ends at ${fmt(end)}, after the main video ends at ${fmt(totalSec)}.` });
    if (!t.text.trim()) issues.push({ id: t.id, message: `Text card ${i + 1} is empty — type some text or delete it.` });
    if (t.text.length > MAX_TEXT_LENGTH) issues.push({ id: t.id, message: `Text card ${i + 1} is over ${MAX_TEXT_LENGTH} characters.` });
  });
  // Sweep-line for the maximum number of overlays visible at once.
  const events: Array<[number, number]> = [];
  for (const o of overlays) { events.push([o.startSec, 1]); events.push([o.startSec + o.durationSec, -1]); }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0;
  for (const [t, d] of events) {
    live += d;
    if (live > MAX_SIMULTANEOUS_OVERLAYS) {
      issues.push({ id: null, message: `${live} overlays (clips and images) show at the same time around ${fmt(t)} — at most ${MAX_SIMULTANEOUS_OVERLAYS} can overlap.` });
      break;
    }
  }
  return issues;
}

/** Clamp a top-left normalized position so a box of the given normalized size stays inside the frame. */
export function containPosition(x: number, y: number, w: number, h: number) {
  return { x: clamp(x, 0, Math.max(0, 1 - w)), y: clamp(y, 0, Math.max(0, 1 - h)) };
}
