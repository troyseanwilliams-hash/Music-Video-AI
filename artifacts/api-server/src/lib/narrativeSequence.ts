export function resolveNarrativeSequence(
  sceneCount: number,
  availableSourceIndexes: number[],
): number[] {
  if (!Number.isInteger(sceneCount) || sceneCount < 1) {
    throw new Error("Narrative stitching requires at least one planned scene.");
  }
  const available = new Set(availableSourceIndexes);
  const sequence = Array.from({ length: sceneCount }, (_, index) => index);
  const missing = sequence.filter((index) => !available.has(index));
  if (missing.length > 0) {
    throw new Error(
      `Narrative stitching is missing required scene${missing.length === 1 ? "" : "s"}: ${missing
        .map((index) => index + 1)
        .join(", ")}.`,
    );
  }
  return sequence;
}