export const MONTAGE_GUIDE_EVENT = "aibeatsync:resume-montage-guide";

export const MONTAGE_GUIDE_STEPS = ["audio", "media", "arrange", "preview", "export"] as const;
export type MontageGuideStep = (typeof MONTAGE_GUIDE_STEPS)[number];
export type MontageGuideStatus = "active" | "skipped" | "submitted";

export interface MontageGuideProgress {
  version: 1;
  status: MontageGuideStatus;
  step: MontageGuideStep;
  completed: MontageGuideStep[];
}

export interface MontageGuideContext {
  hasAudio: boolean;
  hasMedia: boolean;
  arranged: boolean;
  previewPlayed: boolean;
}

export function canContinueMontageStep(step: MontageGuideStep, context: MontageGuideContext) {
  if (step === "audio") return true;
  if (step === "media") return context.hasMedia;
  if (step === "arrange") return context.hasMedia && context.arranged;
  if (step === "preview") return context.hasMedia && context.previewPlayed;
  return false;
}

export function isMontageExportCostKnown(input: {
  fullAccess: boolean;
  trialActive: boolean;
  karaokeHasLyrics: boolean;
  quotaLoaded: boolean;
}) {
  if (!input.fullAccess) return input.quotaLoaded;
  if (input.trialActive && input.karaokeHasLyrics) return input.quotaLoaded;
  return true;
}

const DEFAULT_PROGRESS: MontageGuideProgress = {
  version: 1,
  status: "active",
  step: "audio",
  completed: [],
};

export function montageGuideStorageKey(accountId: string) {
  return `aibeatsync:montage-guide:v1:${accountId}`;
}

export function validateMontageGuideProgress(value: unknown): MontageGuideProgress | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MontageGuideProgress>;
  if (
    candidate.version !== 1 ||
    !["active", "skipped", "submitted"].includes(candidate.status ?? "") ||
    !MONTAGE_GUIDE_STEPS.includes(candidate.step as MontageGuideStep) ||
    !Array.isArray(candidate.completed)
  ) return null;
  const completed = [...new Set(candidate.completed)]
    .filter((step): step is MontageGuideStep => MONTAGE_GUIDE_STEPS.includes(step as MontageGuideStep));
  return { version: 1, status: candidate.status as MontageGuideStatus, step: candidate.step!, completed };
}

export function readMontageGuideProgress(
  accountId: string,
  storage?: Pick<Storage, "getItem"> | null,
) {
  try {
    const available = storage === undefined
      ? (typeof window === "undefined" ? null : window.localStorage)
      : storage;
    if (!available) return null;
    const raw = available.getItem(montageGuideStorageKey(accountId));
    return raw ? validateMontageGuideProgress(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeMontageGuideProgress(
  accountId: string,
  progress: MontageGuideProgress,
  storage?: Pick<Storage, "setItem"> | null,
) {
  try {
    const available = storage === undefined
      ? (typeof window === "undefined" ? null : window.localStorage)
      : storage;
    if (!available) return false;
    available.setItem(montageGuideStorageKey(accountId), JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function contextualCompleted(context: MontageGuideContext): MontageGuideStep[] {
  const completed: MontageGuideStep[] = [];
  if (context.hasAudio) completed.push("audio");
  if (context.hasMedia) completed.push("media");
  if (context.hasMedia && context.arranged) completed.push("arrange");
  if (context.hasMedia && context.previewPlayed) completed.push("preview");
  return completed;
}

export function deriveMontageGuideProgress(
  saved: MontageGuideProgress | null,
  context: MontageGuideContext,
): MontageGuideProgress {
  const base = saved ?? DEFAULT_PROGRESS;
  const actual = contextualCompleted(context);
  const retained = base.completed.filter((step) => {
    if (step === "export") return true;
    // Audio is optional, so an explicit "continue without audio" remains done.
    if (step === "audio") return true;
    return actual.includes(step);
  });
  const completed = [...new Set([...retained, ...actual])];
  // A completed stored step means the user intentionally navigated Back, so it
  // is preserved. Otherwise newly satisfied acquisition may advance on resume.
  const step = saved && base.completed.includes(base.step)
    ? base.step
    : MONTAGE_GUIDE_STEPS.find((candidate) => !completed.includes(candidate)) ?? "export";
  return { ...base, step, completed };
}

export function restartMontageGuide(context: MontageGuideContext) {
  return deriveMontageGuideProgress(
    { version: 1, status: "active", step: "audio", completed: [] },
    context,
  );
}

export function markMontageGuideSubmitted(accountId: string) {
  const saved = readMontageGuideProgress(accountId);
  const next: MontageGuideProgress = {
    ...(saved ?? DEFAULT_PROGRESS),
    status: "submitted",
    step: "export",
    completed: [...new Set([...(saved?.completed ?? []), "export" as const])],
  };
  writeMontageGuideProgress(accountId, next);
  return next;
}