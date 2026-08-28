const PRIVATE_MANIFEST_KEYS = new Set([
  "partialClips",
  "pendingRequests",
  "rejectedRequests",
  "pendingImageRequests",
  "submissionIntents",
  "imageSubmissionIntents",
  "uncertainSubmissions",
  "uncertainImageSubmissions",
  "lipSyncPollUrl",
  "finalizeWithPartial",
  "retryAfter",
  // imageReview is intentionally public to the owning customer: it contains
  // canonical scene paths, revisions, and editable prompts, but no billing
  // bucket or provider submission internals.
]);

function sanitizeManifest(manifest: unknown): unknown {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return manifest;
  }

  const sanitized = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !PRIVATE_MANIFEST_KEYS.has(key)),
  );
  const review = sanitized.imageReview as {
    pendingReplacements?: Record<string, {
      id?: string;
      index: number;
      prompt: string;
      status: string;
      createdAt?: string;
    }>;
  } | undefined;
  if (review?.pendingReplacements) {
    sanitized.imageReview = {
      ...review,
      pendingReplacements: Object.fromEntries(
        Object.entries(review.pendingReplacements).map(([id, item]) => [id, {
          id,
          index: item.index,
          prompt: item.prompt,
          status: item.status,
          createdAt: item.createdAt,
        }]),
      ),
    };
  }
  return sanitized;
}

function publicFailureMessage(errorMessage: unknown, manifest: unknown): string {
  const raw = typeof errorMessage === "string" ? errorMessage : "";
  const meta = manifest && typeof manifest === "object" && !Array.isArray(manifest)
    ? manifest as Record<string, unknown>
    : {};
  const refunded =
    meta.refunded === true
    || /credits? (?:for unfinished work )?were returned|reserved credits were returned/i.test(raw);
  const refundNote = refunded
    ? " Your reserved credits were returned."
    : " You were not charged for unfinished work.";

  if (/content checker|content policy|safety check|request was rejected/i.test(raw)) {
    return `A source image was blocked by automated safety checks.${refundNote} Review the scene wording, remove sensitive or ambiguous details, and start a new generation.`;
  }
  if (/source[- ]image|image generation|image pack/i.test(raw)) {
    return `We couldn't finish creating the source images.${refundNote} Review your scene prompts and start a new generation.`;
  }
  if (/timed? out|timeout/i.test(raw)) {
    return `Generation took too long and was stopped safely.${refundNote} Please start a new generation.`;
  }
  return `We couldn't complete this generation.${refundNote} Please start a new generation or contact support if it happens again.`;
}

export function toCustomerJobView<
  T extends {
    status?: string | null;
    errorMessage?: unknown;
    manifest?: unknown;
  },
>(job: T): T {
  return {
    ...job,
    errorMessage: job.status === "failed"
      ? publicFailureMessage(job.errorMessage, job.manifest)
      : null,
    manifest: sanitizeManifest(job.manifest),
  } as T;
}