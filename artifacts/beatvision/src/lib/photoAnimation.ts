export type PhotoAnimationSource =
  | { kind: "asset"; imageAssetId: string }
  | { kind: "upload"; objectPath: string };

export type PhotoAnimationInput = {
  source: PhotoAnimationSource;
  prompt: string;
  durationSeconds: 5 | 10;
  provider: "kling" | "runway";
  resolution: "720p";
  aspectRatio: "16:9" | "9:16" | "1:1";
};

export type PhotoAnimationQuote = {
  totalCredits: number;
  videoCredits: number;
  imageCredits: 0;
  prompt: string;
  planFingerprint: string;
  durationSeconds: 5 | 10;
  provider: "kling" | "runway";
  resolution: "720p";
  aspectRatio: "16:9" | "9:16" | "1:1";
};

export type PendingPhotoAnimation = {
  jobId: string;
  sourceKey: string;
  createdAt: number;
};

export type PhotoAnimationOperationIntent = {
  idempotencyKey: string;
  requestFingerprint: string;
  sourceKey: string;
  createdAt: number;
};

const STORAGE_PREFIX = "photo-animation:pending:";
const OPERATION_PREFIX = "photo-animation:operation:";

export function photoAnimationSourceKey(source: PhotoAnimationSource): string {
  return source.kind === "asset"
    ? `asset:${source.imageAssetId}`
    : `upload:${source.objectPath}`;
}

export function photoAnimationStorageKey(userId: string, source: PhotoAnimationSource): string {
  return `${STORAGE_PREFIX}${userId}:${photoAnimationSourceKey(source)}`;
}

export function photoAnimationOperationStorageKey(userId: string, source: PhotoAnimationSource): string {
  return `${OPERATION_PREFIX}${userId}:${photoAnimationSourceKey(source)}`;
}

export async function photoAnimationRequestFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function matchesPhotoAnimationOperation(
  intent: PhotoAnimationOperationIntent,
  requestFingerprint: string,
): boolean {
  return intent.requestFingerprint === requestFingerprint;
}

export function isUnambiguousPhotoAnimationRejection(status: number, code?: string): boolean {
  if ([400, 401, 402, 403, 422].includes(status)) return true;
  return status === 409 && ["STALE_PRICE", "STALE_PLAN", "SOURCE_CHANGED"].includes(code ?? "");
}

export function samePhotoAnimationInput(a: PhotoAnimationInput, b: PhotoAnimationInput): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function storyHandoffUrl(objectPath: string, starter?: string): string {
  const query = new URLSearchParams({ referenceImagePath: objectPath });
  const safeStarter = starter?.trim().slice(0, 1000);
  if (safeStarter) query.set("prompt", safeStarter);
  return `/generate?${query.toString()}`;
}

export function readPendingPhotoAnimation(
  userId: string,
  source: PhotoAnimationSource,
): PendingPhotoAnimation | null {
  try {
    const raw = localStorage.getItem(photoAnimationStorageKey(userId, source));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingPhotoAnimation>;
    if (
      typeof value.jobId !== "string" ||
      typeof value.sourceKey !== "string" ||
      value.sourceKey !== photoAnimationSourceKey(source) ||
      typeof value.createdAt !== "number"
    ) return null;
    return value as PendingPhotoAnimation;
  } catch {
    return null;
  }
}

export function writePendingPhotoAnimation(
  userId: string,
  source: PhotoAnimationSource,
  jobId: string,
): void {
  const pending: PendingPhotoAnimation = {
    jobId,
    sourceKey: photoAnimationSourceKey(source),
    createdAt: Date.now(),
  };
  localStorage.setItem(photoAnimationStorageKey(userId, source), JSON.stringify(pending));
  window.dispatchEvent(new CustomEvent("photo-animation-pending", { detail: pending }));
}

export function readPhotoAnimationOperationIntent(
  userId: string,
  source: PhotoAnimationSource,
): PhotoAnimationOperationIntent | null {
  try {
    const raw = localStorage.getItem(photoAnimationOperationStorageKey(userId, source));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PhotoAnimationOperationIntent>;
    if (
      typeof value.idempotencyKey !== "string"
      || typeof value.requestFingerprint !== "string"
      || typeof value.sourceKey !== "string"
      || value.sourceKey !== photoAnimationSourceKey(source)
      || typeof value.createdAt !== "number"
    ) return null;
    return value as PhotoAnimationOperationIntent;
  } catch {
    return null;
  }
}

export function writePhotoAnimationOperationIntent(
  userId: string,
  source: PhotoAnimationSource,
  intent: Omit<PhotoAnimationOperationIntent, "sourceKey" | "createdAt">,
): void {
  localStorage.setItem(photoAnimationOperationStorageKey(userId, source), JSON.stringify({
    ...intent,
    sourceKey: photoAnimationSourceKey(source),
    createdAt: Date.now(),
  } satisfies PhotoAnimationOperationIntent));
}

export function clearPhotoAnimationOperationIntent(userId: string, source: PhotoAnimationSource): void {
  localStorage.removeItem(photoAnimationOperationStorageKey(userId, source));
}

export function clearPendingPhotoAnimation(userId: string, source: PhotoAnimationSource): void {
  localStorage.removeItem(photoAnimationStorageKey(userId, source));
  window.dispatchEvent(new Event("photo-animation-pending"));
}

export function clearPendingPhotoAnimationBySourceKey(userId: string, sourceKey: string): void {
  localStorage.removeItem(`${STORAGE_PREFIX}${userId}:${sourceKey}`);
  window.dispatchEvent(new Event("photo-animation-pending"));
}

export function listPendingPhotoAnimations(userId: string): PendingPhotoAnimation[] {
  const prefix = `${STORAGE_PREFIX}${userId}:`;
  const pending: PendingPhotoAnimation[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key) || "") as PendingPhotoAnimation;
      if (typeof value.jobId === "string" && typeof value.sourceKey === "string") pending.push(value);
    } catch {
      // Ignore malformed browser state.
    }
  }
  return pending;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}