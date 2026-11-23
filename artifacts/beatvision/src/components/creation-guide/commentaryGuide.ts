export const COMMENTARY_GUIDE_PARAM = "commentary";

export interface CommentaryGuideStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector of the real editor control this step points to. */
  target: string;
  control: string;
  missingHint: string;
}

export const COMMENTARY_GUIDE_STEPS: CommentaryGuideStep[] = [
  {
    id: "main",
    title: "Add your main video",
    body: "Your main track is the episode or video being discussed. Open the Media tab and add it there. The preview and timeline remain visible as you switch tabs.",
    target: '[data-montage-guide="media"]',
    control: "Add media",
    missingHint: "Scroll to the media buttons near the top of the editor.",
  },
  {
    id: "overlay",
    title: "Add a commentary or reaction clip",
    body: "Open the Overlay tab, then upload a video clip or still image, choose existing project or Gallery media, or add a text card. You can add multiple layers.",
    target: '[data-commentary-guide="overlays"]',
    control: "Overlay tab",
    missingHint: "Open the Overlay tab to add clips, images, or text.",
  },
  {
    id: "layout",
    title: "Pick Commentary or Reaction",
    body: "Commentary centers your clip over a blurred copy. Reaction layouts use a smaller window you can drag or resize in the preview. Center 16:9 keeps the overlay centered and blurs the sides; border presets decorate video and image overlays.",
    target: '[data-commentary-guide="overlays"]',
    control: "Layout buttons",
    missingHint: "Select an overlay in Overlays & text cards to see the layout buttons.",
  },
  {
    id: "timing",
    title: "Set timing and volume",
    body: "Select an overlay to set its start and duration, or place it at the playhead. Drag its bar on the timeline to adjust timing. Save the project to keep each layer's time slot.",
    target: '[data-commentary-guide="overlays"]',
    control: "Overlay timing",
    missingHint: "Open Overlay and select a layer to edit its timing.",
  },
  {
    id: "text",
    title: "Add text cards",
    body: "Add text cards from the Overlay tab for titles or facts. Text does not wrap automatically; press Enter where you want each new line.",
    target: '[data-commentary-guide="overlays"]',
    control: "Add text card",
    missingHint: "Open the Overlay tab to add text cards.",
  },
  {
    id: "save",
    title: "Save your project",
    body: "Save keeps your overlays and text cards with the project. This guide never saves or changes your draft for you.",
    target: '[data-commentary-guide="save"]',
    control: "Save",
    missingHint: "Save is at the top of the editor.",
  },
  {
    id: "export",
    title: "Review, then export",
    body: "Creator Studio exports go up to 1080p and timelines up to 30 minutes. Check the estimate, confirm you have rights to every clip (watermarks in sources stay visible), then export when you are ready. The guide will not export or spend credits.",
    target: '[data-montage-guide="export"]',
    control: "Export",
    missingHint: "Export is at the bottom of the editor.",
  },
];

export function clampCommentaryStep(index: number): number {
  return Math.min(Math.max(0, Math.floor(index) || 0), COMMENTARY_GUIDE_STEPS.length - 1);
}

export function isCommentaryGuideRequested(search: string): boolean {
  return new URLSearchParams(search).get("guide") === COMMENTARY_GUIDE_PARAM;
}

export function editorReturnTo(search: string): string {
  return isCommentaryGuideRequested(search) ? `/editor?guide=${COMMENTARY_GUIDE_PARAM}` : "/editor";
}
