export function hasCompleteSavedClipSet(
  persisted: Record<string, string>,
  expectedClipCount: number,
): boolean {
  if (!Number.isInteger(expectedClipCount) || expectedClipCount <= 0) return false;
  if (Object.keys(persisted).some((key) =>
    !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= expectedClipCount
  )) return false;

  for (let index = 0; index < expectedClipCount; index++) {
    if (typeof persisted[index] !== "string" || !persisted[index]!.trim()) return false;
  }

  return true;
}