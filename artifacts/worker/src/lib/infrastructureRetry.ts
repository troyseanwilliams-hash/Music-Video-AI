export const INFRASTRUCTURE_RETRY = "[INFRASTRUCTURE_RETRY]";
export const MAX_NO_CHARGE_POLL_RECOVERIES = 8;

export type PollRecoveryManifest = {
  providerPollRecoveryCount?: number;
  imagePollRecoveryCount?: number;
};

export function savedOutputsCoverEveryScene(
  sceneCount: number,
  persisted: Record<string, string>,
  pending: Record<string, string>,
): boolean {
  return Number.isInteger(sceneCount) && sceneCount > 0 && Array.from(
    { length: sceneCount },
    (_, index) => Boolean(persisted[index]) || /^https:\/\//i.test(pending[index] ?? ""),
  ).every(Boolean);
}

export type FailedSavedOutputRecoveryManifest = {
  partialClips?: Record<string, string>;
  pendingRequests?: Record<string, string>;
  submissionIntents?: Record<string, unknown>;
  uncertainSubmissions?: Record<string, unknown>;
  rejectedRequests?: Record<string, unknown>;
};

export function canResumeFailedSavedOutputRecovery(
  sceneCount: number,
  manifest: FailedSavedOutputRecoveryManifest,
): boolean {
  if (!Number.isInteger(sceneCount) || sceneCount <= 0) return false;
  if (
    Object.keys(manifest.submissionIntents ?? {}).length > 0 ||
    Object.keys(manifest.uncertainSubmissions ?? {}).length > 0 ||
    Object.keys(manifest.rejectedRequests ?? {}).length > 0
  ) {
    return false;
  }
  const validIndex = (key: string) =>
    /^(0|[1-9]\d*)$/.test(key) && Number(key) < sceneCount;
  const persisted = manifest.partialClips ?? {};
  const pending = manifest.pendingRequests ?? {};
  const persistedEntries = Object.entries(persisted);
  const pendingEntries = Object.entries(pending);
  if (pendingEntries.length === 0) return false;
  if (!persistedEntries.every(([key, path]) => validIndex(key) && Boolean(path?.trim()))) {
    return false;
  }
  if (!pendingEntries.every(([key, url]) => validIndex(key) && /^https:\/\//i.test(url))) {
    return false;
  }
  return savedOutputsCoverEveryScene(sceneCount, persisted, pending);
}

export function planNoChargePollRecovery(
  manifest: PollRecoveryManifest,
  imageTimeout: boolean,
): {
  countKey: "providerPollRecoveryCount" | "imagePollRecoveryCount";
  nextCount: number;
  canRetry: boolean;
} {
  const countKey = imageTimeout
    ? "imagePollRecoveryCount"
    : "providerPollRecoveryCount";
  const rawCount = manifest[countKey];
  const previousCount = rawCount === undefined
    ? 0
    : Number.isInteger(rawCount) && rawCount >= 0
      ? rawCount
      : MAX_NO_CHARGE_POLL_RECOVERIES;
  const nextCount = previousCount + 1;
  return {
    countKey,
    nextCount,
    canRetry: nextCount <= MAX_NO_CHARGE_POLL_RECOVERIES,
  };
}

const TRANSIENT_INFRASTRUCTURE_PATTERN =
  /connection terminated|connection timeout|database.*(?:timeout|unavailable)|Failed query:\s*update\s+"jobs"\s+set\s+"progress_percent"|Failed query:\s*select\s+"status",\s*"claimed_at"\s+from\s+"jobs"|ECONNRESET|ETIMEDOUT|EPIPE|ENETUNREACH|EAI_AGAIN|socket hang up|TimeoutError|operation was aborted due to timeout|service unavailable|bad gateway/i;

export function isTransientInfrastructureError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const detail = current instanceof Error
      ? `${current.name}: ${current.message}`
      : String(current);
    if (detail.includes(INFRASTRUCTURE_RETRY)) return true;
    if (TRANSIENT_INFRASTRUCTURE_PATTERN.test(detail)) return true;
    current = current instanceof Error
      ? (current as Error & { cause?: unknown }).cause
      : undefined;
  }
  return false;
}

export function recoverableInfrastructureError(error: unknown): Error {
  if (error instanceof Error && error.message.includes(INFRASTRUCTURE_RETRY)) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${INFRASTRUCTURE_RETRY} ${detail}`, { cause: error });
}