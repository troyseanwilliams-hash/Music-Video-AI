export function hasCompleteSavedClipSet(
  persisted: Record<string, string>,
  expectedClipCount: number,
): boolean {
  if (!Number.isInteger(expectedClipCount) || expectedClipCount <= 0) return false;

  for (let index = 0; index < expectedClipCount; index++) {
    if (!persisted[index]) return false;
  }

  return true;
}