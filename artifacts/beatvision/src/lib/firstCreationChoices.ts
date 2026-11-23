import { getStarterCost } from "./starterVideo";

/** Keep the welcome dialog and empty dashboard aligned. Routes retain their existing guides. */
export const FIRST_CREATION_CHOICES = [
  {
    goal: "montage",
    title: "Use my own media",
    description: "Turn your clips and photos into a video in Creator Studio. Clean exports are included during your active trial, within its limits. Paid add-ons are optional.",
    href: "/editor?guide=montage",
  },
  {
    goal: "generate",
    title: "Make a short AI video",
    description: `A guided 5-second vertical video for ${getStarterCost().total} credits, including its scene image. Use your music or start without audio. Approve the storyboard before spending.`,
    href: "/generate?guide=starter",
  },
  {
    goal: "images",
    title: "Create images",
    description: "Turn an idea into images for a post or a future video. Choose how many and review the credit total before creating.",
    href: "/images",
  },
] as const;
