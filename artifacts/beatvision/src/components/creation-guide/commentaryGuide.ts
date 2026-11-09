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
    body: "Your main track is the episode or video being discussed. Add it with the media buttons; the overlay controls appear once the timeline has something on it.",
    target: '[data-montage-guide="media"]',
    control: "Add media",
    missingHint: "Scroll to the media buttons near the top of the editor.",
  },
  {
    id: "overlay",
    title: "Add a commentary or reaction clip",
    body: "Open Overlays & text cards, then choose Upload overlay clip or Use existing clip. The clip starts at the current playhead.",
    target: '[data-commentary-guide="overlays"]',
    control: "Overlays & text cards",
    missingHint: "Add a main video first to reveal Overlays & text cards.",
  },
  {
    id: "layout",
    title: "Pick Commentary or Reaction",
    body: "Commentary fills the frame with your clip centred over a blurred copy. Reaction right or left makes a smaller window: drag it in the preview to move it and drag the corner handle to resize.",
    target: '[data-commentary-guide="overlays"]',
    control: "Layout buttons",
    missingHint: "Select an overlay in Overlays & text cards to see the layout buttons.",
  },
  {
    id: "timing",
    title: "Set timing and volume",
    body: "Use Starts at, Duration and Skip into clip, or At playhead. Overlay sound has its own volume, so the main video's audio stays untouched.",
    target: '[data-commentary-guide="overlays"]',
    control: "Timing and Overlay sound",
    missingHint: "Select an overlay to see its timing and volume controls.",
  },
  {
    id: "text",
    title: "Add text cards",
    body: "Add text card for titles or facts. Text never wraps on its own; press Enter where you want each new line.",
    target: '[data-commentary-guide="overlays"]',
    control: "Add text card",
    missingHint: "Add a main video first to reveal Add text card.",
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
    body: "Montage exports go up to 1080p and timelines up to 30 minutes. Check the estimate, confirm you have rights to every clip (watermarks in sources stay visible), then export when you are ready. The guide will not export or spend credits.",
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
