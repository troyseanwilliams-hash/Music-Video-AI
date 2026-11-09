export interface ReleaseNote {
  id: string;
  date: string;
  isoDate: string;
  title: string;
  summary: string;
  items: { heading: string; body: string }[];
  links: { label: string; href: string }[];
}

export const MONTAGE_TIMELINE_LIMIT_MINUTES = 30;
export const MONTAGE_MAX_RESOLUTION = "1080p";

/** Only implemented, shipped functionality belongs here. Do not add backdated entries. */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    id: "2026-11-09-montage-commentary",
    date: "November 9, 2026",
    isoDate: "2026-11-09",
    title: "Commentary and reaction overlays in Montage Studio",
    summary:
      "Podcast and commentary creators can now layer a second clip and on-screen text cards over a main video, without leaving Montage Studio. Simple single-track editing works exactly as before; overlays are optional.",
    items: [
      { heading: "Overlay clips", body: "Open Overlays & text cards, then Upload overlay clip or Use existing clip from this project or your Gallery. New items start at the playhead." },
      { heading: "Commentary or Reaction layouts", body: "Commentary fills the frame with the clip centred and a blurred copy behind it. Reaction right and Reaction left place a smaller window you can drag to move and resize from its corner handle in the preview." },
      { heading: "Exact timing", body: "Set Starts at, Duration and Skip into clip, snap a clip to the playhead with At playhead, or use End with main video. Overlay bars can also be dragged along the layer timeline." },
      { heading: "Independent overlay sound", body: "Each overlay has its own volume, so you can manually lower or mute a reaction clip without changing your main video's volume." },
      { heading: "Text cards", body: "Add text card for titles, quotes and fact cards. Text does not wrap automatically; press Enter where you want a new line, and the export matches the preview." },
      { heading: "Saved with your project", body: "Save and Save as keep overlays and text cards with the project, so you can reopen and keep editing." },
      { heading: "Limits", body: "Montage Studio exports at up to 1080p and supports timelines up to 30 minutes. The 30-minute limit applies to Montage Studio only; AI video generation keeps its own separate length limits and credit estimates." },
      { heading: "Rights and watermarks", body: "Clips are shown in full by default, including any watermark already in the source. Only use footage you own or are licensed to use, and confirm content rights before exporting." },
    ],
    links: [
      { label: "Open Montage Studio", href: "/editor" },
      { label: "Start the commentary walkthrough", href: "/editor?guide=commentary" },
      { label: "Read the tutorial", href: "/tutorial/script-to-video#commentary-overlays" },
    ],
  },
];
