import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "./creditCost.js";

export function isOwnedUploadObjectPath(
  objectPath: string | undefined,
  userId: string,
): boolean {
  if (!objectPath || !userId) return false;
  const ownerPrefix = `/objects/uploads/${userId}/`;
  if (!objectPath.startsWith(ownerPrefix)) return false;
  const filename = objectPath.slice(ownerPrefix.length);
  return filename.length > 0 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename);
}

export type ImageReviewReplacementBillingScene = {
  source?: string;
  status?: string;
  errorMessage?: string;
};

export function imageReviewReplacementCredits(
  scene: ImageReviewReplacementBillingScene,
): number {
  if (
    scene.status === "failed"
    && scene.errorMessage?.startsWith("This stored image could not be read.")
  ) {
    return 0;
  }
  return GENERATED_IMAGE_CREDITS_PER_VISUAL;
}