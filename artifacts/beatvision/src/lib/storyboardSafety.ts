export type StoryboardSafetyStatus = "clean" | "adjusted" | "blocked";

export type StoryboardSafety = {
  status: StoryboardSafetyStatus;
  reason?: string;
};

export type StoryboardSafetyDisplay = {
  label: "Ready" | "Adjusted for generation" | "Needs revision";
  reason: string;
  canGenerate: boolean;
};

const SAFETY_STATUSES = new Set<StoryboardSafetyStatus>(["clean", "adjusted", "blocked"]);

export function parseStoryboardSafety(value: unknown): StoryboardSafety | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.status !== "string" || !SAFETY_STATUSES.has(candidate.status as StoryboardSafetyStatus)) {
    return undefined;
  }
  const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";
  return {
    status: candidate.status as StoryboardSafetyStatus,
    ...(reason ? { reason } : {}),
  };
}

export function getStoryboardSafetyDisplay(
  safety: StoryboardSafety | undefined,
): StoryboardSafetyDisplay {
  if (!safety) {
    return {
      label: "Needs revision",
      reason: "Safety check required. Rebuild prompts to check again.",
      canGenerate: false,
    };
  }
  if (safety.status === "clean") {
    return {
      label: "Ready",
      reason: safety.reason ?? "Safety check passed.",
      canGenerate: true,
    };
  }
  if (safety.status === "adjusted") {
    return {
      label: "Adjusted for generation",
      reason: safety.reason ?? "The prompt was adjusted for generation.",
      canGenerate: true,
    };
  }
  return {
    label: "Needs revision",
    reason: safety.reason ?? "Revise this prompt, then rebuild to check again.",
    canGenerate: false,
  };
}

export function isSafetyRejectionCode(code: unknown): boolean {
  if (typeof code !== "string") return false;
  const normalized = code.toUpperCase();
  return (
    (normalized.includes("SAFETY")
      && (normalized.includes("REJECT") || normalized.includes("BLOCK")))
    || normalized === "PROMPT_BLOCKED"
    || normalized === "PROMPT_REJECTED"
    || normalized === "CONTENT_POLICY_VIOLATION"
    || normalized === "MODERATION_REJECTED"
  );
}