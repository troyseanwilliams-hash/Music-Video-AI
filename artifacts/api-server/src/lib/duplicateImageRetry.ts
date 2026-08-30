import { randomUUID } from "crypto";
import { shortenCompletePrompt } from "./promptText.js";

type RetryScene = {
  index: number;
  canonicalPath?: string;
  revision: number;
  source: "original_generation" | "regenerated" | "generated_gallery" | "local_upload";
  prompt: string;
  status?: "ready" | "failed" | "pending" | "uncertain";
  errorMessage?: string;
  acceptedRequestId?: string;
};

type RetryReplacement = {
  id: string;
  index: number;
  prompt: string;
  credits: number;
  subscriptionCredits: number;
  topupCredits: number;
  status: "queued" | "processing" | "uncertain";
  createdAt: string;
};

type RetryReview = {
  phase: "awaiting_approval" | "approved";
  revision: number;
  approvedRevision?: number;
  scenes: Record<string, RetryScene>;
  pendingReplacements?: Record<string, RetryReplacement>;
};

export type DuplicateImageRetryMeta = {
  refunded?: boolean;
  imageFirstVersion?: number;
  imageFirstRefundedCredits?: number;
  bundledLipSyncEnabled?: boolean;
  imageReview?: RetryReview;
};

export type PreparedDuplicateImageRetry = {
  nextReview: RetryReview;
  replacementIndex: number;
  duplicateOfIndex: number;
  resumeCredits: number;
};

const DUPLICATE_POSITIONS =
  /duplicate source image content at positions (\d+) and (\d+)/i;

export function hasDuplicateImageFailure(errorMessage: string | null | undefined): boolean {
  return DUPLICATE_POSITIONS.test(errorMessage ?? "");
}

export function prepareDuplicateImageRetry(
  meta: DuplicateImageRetryMeta,
  errorMessage: string | null | undefined,
  options: { replacementId?: string; createdAt?: string } = {},
): PreparedDuplicateImageRetry | null {
  const positions = DUPLICATE_POSITIONS.exec(errorMessage ?? "");
  const review = meta.imageReview;
  const resumeCredits = Math.max(0, meta.imageFirstRefundedCredits ?? 0);
  if (
    !positions
    || meta.refunded !== true
    || meta.imageFirstVersion !== 1
    || meta.bundledLipSyncEnabled === true
    || review?.phase !== "approved"
    || resumeCredits <= 0
  ) {
    return null;
  }

  const duplicateOfIndex = Number(positions[1]) - 1;
  const replacementIndex = Number(positions[2]) - 1;
  const duplicateOfScene = review.scenes[String(duplicateOfIndex)];
  const replacementScene = review.scenes[String(replacementIndex)];
  if (!duplicateOfScene || !replacementScene) return null;

  const replacementId = options.replacementId ?? randomUUID();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const replacementPrompt = shortenCompletePrompt(
    [
      `Required replacement for scene ${replacementIndex + 1}: create a clearly different image from scene ${duplicateOfIndex + 1}.`,
      "Change the camera angle, framing, subject placement, lighting, and background arrangement.",
      "Do not reuse the earlier image or composition.",
      `Original scene requirement: ${replacementScene.prompt}`,
    ].join(" "),
    1000,
  );
  const { approvedRevision: _approvedRevision, ...reviewWithoutApproval } = review;
  const pending: RetryReplacement = {
    id: replacementId,
    index: replacementIndex,
    prompt: replacementPrompt,
    credits: 0,
    subscriptionCredits: 0,
    topupCredits: 0,
    status: "queued",
    createdAt,
  };

  return {
    replacementIndex,
    duplicateOfIndex,
    resumeCredits,
    nextReview: {
      ...reviewWithoutApproval,
      phase: "awaiting_approval",
      scenes: {
        ...review.scenes,
        [String(replacementIndex)]: {
          ...replacementScene,
          status: "pending",
          errorMessage: `Automatically regenerating this scene because it was too similar to scene ${duplicateOfIndex + 1}.`,
        },
      },
      pendingReplacements: {
        ...(review.pendingReplacements ?? {}),
        [replacementId]: pending,
      },
    },
  };
}