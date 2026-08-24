export function shouldShowVideoScenePreviews(
  jobType: string | null | undefined,
  status: string | null | undefined,
  gridSlots: number,
): boolean {
  if (jobType === "image_pack") return false;
  return (status === "generating" || status === "stitching") && gridSlots > 0;
}