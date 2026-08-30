const DUPLICATE_CLIP_RE =
  /duplicate generated clip content at positions (\d+) and (\d+)/i;

export type DuplicateClipRetryMeta = {
  strictUniqueSourcesVersion?: number;
  refunded?: boolean;
  imageFirstRefundedCredits?: number;
  partialClips?: Record<string, string>;
  pendingRequests?: Record<string, unknown>;
  rejectedRequests?: Record<string, unknown>;
  submissionIntents?: Record<string, unknown>;
  uncertainSubmissions?: Record<string, unknown>;
  storyboard?: { numClips?: number };
};

export function hasDuplicateClipFailure(
  errorMessage: string | null | undefined,
): boolean {
  return DUPLICATE_CLIP_RE.test(errorMessage ?? "");
}

export function canResumeDuplicateClipJob(
  meta: DuplicateClipRetryMeta,
  errorMessage: string | null | undefined,
): boolean {
  if (!hasDuplicateClipFailure(errorMessage) || meta.strictUniqueSourcesVersion !== 1) return false;
  const planned = meta.storyboard?.numClips ?? 0;
  if (planned <= 0 || (meta.refunded && (meta.imageFirstRefundedCredits ?? 0) > 0)) return false;
  const saved = meta.partialClips ?? {};
  return Array.from(
    { length: planned },
    (_, index) => Boolean(saved[String(index)]),
  ).every(Boolean);
}