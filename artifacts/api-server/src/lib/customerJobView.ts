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
]);

function sanitizeManifest(manifest: unknown): unknown {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return manifest;
  }

  return Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !PRIVATE_MANIFEST_KEYS.has(key)),
  );
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