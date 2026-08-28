export function shouldShowVideoScenePreviews(
  jobType: string | null | undefined,
  status: string | null | undefined,
  gridSlots: number,
): boolean {
  if (jobType === "image_pack") return false;
  return (status === "generating" || status === "stitching") && gridSlots > 0;
}

export function latestStoryboardReferenceIndex(
  referenceImages: Record<number, unknown> | undefined,
): number | null {
  if (!referenceImages) return null;
  const indexes = Object.keys(referenceImages)
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0);
  return indexes.length > 0 ? Math.max(...indexes) : null;
}