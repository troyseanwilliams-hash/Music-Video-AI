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

export function toCustomerJobView<
  T extends {
    status?: string | null;
    errorMessage?: unknown;
    manifest?: unknown;
  },
>(job: T): T {
  return {
    ...job,
    errorMessage: null,
    manifest: sanitizeManifest(job.manifest),
  } as T;
}