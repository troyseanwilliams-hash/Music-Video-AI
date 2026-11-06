import {
  estimateCreditCost,
  estimateGeneratedImageCost,
  GENERATED_IMAGE_CREDITS_PER_VISUAL,
  type AiProvider,
} from "@/lib/creditPricing";
import type { CreateJobRequestRequestedDuration } from "@workspace/api-client-react";

// The beginner first-video configuration. Every value here is submitted
// through the normal job request, so the server prices it independently.
export const STARTER_CONFIG = {
  provider: "kling" as AiProvider,
  durationSeconds: 5,
  resolution: "720p",
  aspectRatio: "9:16",
  generationMode: "narrative",
  visualSource: "generated_images",
} as const;

export const STARTER_DIRECTIONS = [
  { id: "night-drive", label: "Night drive", style: "neon", prompt: "a lone car gliding through a rain-soaked neon city at night, reflections pulsing to the beat" },
  { id: "golden-hour", label: "Golden hour", style: "cinematic", prompt: "a singer silhouetted on a rooftop at golden hour, warm haze, slow cinematic push-in" },
  { id: "liquid-color", label: "Liquid color", style: "abstract", prompt: "abstract liquid ink blooming in deep violet and electric blue, hypnotic flowing motion" },
  { id: "dreamscape", label: "Dreamscape", style: "fantasy", prompt: "floating islands above a pastel sea of clouds, drifting particles, soft dreamy light" },
] as const;

export type StarterAudioChoice = "upload" | "library" | "silent";

export interface StarterCost {
  video: number;
  images: number;
  total: number;
}

/** Cost of the starter video via the shared estimators (mirror of creditCost.ts). */
export function getStarterCost(): StarterCost {
  const dur = String(STARTER_CONFIG.durationSeconds) as CreateJobRequestRequestedDuration;
  const video = estimateCreditCost(dur, STARTER_CONFIG.provider, STARTER_CONFIG.resolution, null, "narrative");
  const images = estimateGeneratedImageCost(dur, null, "narrative", "generated_images", STARTER_CONFIG.provider);
  return { video, images, total: video + images };
}

export type StarterAlternative = "starter" | "images" | "montage" | "unknown";

/** Pick the best affordable path. An unknown (not yet loaded) balance never advertises affordability. */
export function pickStarterPath(balance: number | null | undefined, isAdmin = false): StarterAlternative {
  if (isAdmin) return "starter";
  if (balance == null) return "unknown";
  if (balance >= getStarterCost().total) return "starter";
  if (balance >= GENERATED_IMAGE_CREDITS_PER_VISUAL) return "images";
  return "montage";
}

export function formatExpiry(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.ceil((t - now) / 86_400_000);
  if (days <= 0) return "Welcome credits have expired";
  return `Welcome credits expire in ${days} day${days === 1 ? "" : "s"}`;
}

/** Next creations that fit the remaining balance (never auto-started). */
export function affordableNextSteps(
  balance: number | null | undefined,
  aiEligible = true,
): Array<"starter_video" | "images" | "montage"> {
  const steps: Array<"starter_video" | "images" | "montage"> = [];
  if (!aiEligible) return ["montage"];
  if (balance != null && balance >= getStarterCost().total) steps.push("starter_video");
  if (balance != null && balance >= GENERATED_IMAGE_CREDITS_PER_VISUAL) steps.push("images");
  steps.push("montage");
  return steps;
}

/** Per-user dismissal so a new account on a shared browser still sees the starter. */
export function starterDismissKey(userId: string): string {
  return `bv-starter-dismissed-v2-${userId}`;
}

export function isStarterDismissed(userId: string | null | undefined): boolean {
  if (!userId) return true;
  try { return localStorage.getItem(starterDismissKey(userId)) === "true"; } catch { return false; }
}

export function markStarterDismissed(userId: string | null | undefined): void {
  if (!userId) return;
  try { localStorage.setItem(starterDismissKey(userId), "true"); } catch { /* private mode */ }
}

/** True when the URL carries a handoff from another page that must not be overridden. */
export function hasGenerateHandoff(search: string): boolean {
  const p = new URLSearchParams(search);
  return !!(p.get("audioObjectPath") || p.get("prompt") || p.get("referenceImagePath"));
}

/** AI generation eligibility for offering paid next steps (expired unpaid trial = not eligible). */
export function isAiEligible(
  user: { isAdmin?: boolean | null; subscriptionStatus?: string | null; trialEndsAt?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (user.subscriptionStatus === "trial") {
    const end = user.trialEndsAt ? new Date(user.trialEndsAt).getTime() : NaN;
    return Number.isFinite(end) && end > now;
  }
  return user.subscriptionStatus === "active";
}

/** Advanced settings the starter would replace; shown before applying it on re-entry. */
export function advancedDraftItems(d: {
  lyrics: boolean; lipSync: boolean; reference: boolean; endFrame: boolean; sceneSources: number; character: boolean;
}): string[] {
  const items: string[] = [];
  if (d.lyrics) items.push("lyrics");
  if (d.lipSync) items.push("Lip Sync");
  if (d.reference) items.push("reference image");
  if (d.endFrame) items.push("end frame");
  if (d.sceneSources > 0) items.push("chosen scene images");
  if (d.character) items.push("character");
  return items;
}
