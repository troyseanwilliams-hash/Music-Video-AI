export type MontageClipIdentity = {
  visualIndex: number;
};

export type PersistedMontageTimelineEntry = {
  index: number;
  visualIndex: number;
  startTime: number;
  duration: number;
};

function persistedVisualOrder(rawTimeline: unknown): number[] {
  if (!Array.isArray(rawTimeline)) return [];
  return rawTimeline
    .filter((value): value is PersistedMontageTimelineEntry => {
      if (!value || typeof value !== "object") return false;
      const entry = value as Record<string, unknown>;
      return (
        Number.isFinite(entry.index)
        && Number.isFinite(entry.visualIndex)
        && Number.isFinite(entry.startTime)
        && Number.isFinite(entry.duration)
      );
    })
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.visualIndex);
}

// Versioned image-first jobs have no reusable montage library: every timeline
// slot is backed by its own persisted visual and its own generated clip.
// Validate that contract here rather than silently applying the legacy cycling
// and substitution policy below.
export function resolveStrictMontageSequence(
  rawTimeline: unknown,
  clips: MontageClipIdentity[],
  totalDuration: number,
  slotDuration: number,
): number[] {
  const sceneCount = Math.max(1, Math.ceil(totalDuration / Math.max(1, slotDuration)));
  if (!Array.isArray(rawTimeline) || rawTimeline.length !== sceneCount) {
    throw new Error(`Strict montage timeline must contain exactly ${sceneCount} segments`);
  }
  const timeline = rawTimeline.map((value, position) => {
    if (!value || typeof value !== "object") {
      throw new Error(`Strict montage timeline segment ${position} is invalid`);
    }
    const entry = value as Record<string, unknown>;
    if (
      !Number.isInteger(entry.index)
      || !Number.isInteger(entry.visualIndex)
      || !Number.isFinite(entry.startTime)
      || !Number.isFinite(entry.duration)
      || typeof entry.duration !== "number"
      || entry.duration <= 0
      || entry.index !== position
      || entry.visualIndex !== position
    ) {
      throw new Error(`Strict montage timeline segment ${position} does not preserve its visual identity`);
    }
    return entry;
  });
  if (
    clips.length !== sceneCount
    || new Set(clips.map((clip) => clip.visualIndex)).size !== sceneCount
    || clips.some((clip, index) => clip.visualIndex !== index)
  ) {
    throw new Error("Strict montage requires one distinct clip for every timeline segment");
  }
  return timeline.map((_, index) => index);
}

export function resolveMontageSequence(
  rawTimeline: unknown,
  clips: MontageClipIdentity[],
  totalDuration: number,
  slotDuration: number,
): number[] {
  if (clips.length === 0) return [];
  const sceneCount = Math.max(1, Math.ceil(totalDuration / Math.max(1, slotDuration)));
  const preferredOrder = persistedVisualOrder(rawTimeline);
  const usage = new Array(clips.length).fill(0) as number[];
  let previousClipIndex = -1;

  return Array.from({ length: sceneCount }, (_, timelineIndex) => {
    const preferredVisualIndex = preferredOrder.length > 0
      ? preferredOrder[timelineIndex % preferredOrder.length]!
      : timelineIndex;
    const exactClipIndex = clips.findIndex((clip) => clip.visualIndex === preferredVisualIndex);

    let clipIndex = exactClipIndex;
    if (clipIndex < 0 || (clips.length > 1 && clipIndex === previousClipIndex)) {
      const leastUsed = Math.min(
        ...usage.filter((_, index) => clips.length === 1 || index !== previousClipIndex),
      );
      clipIndex = usage.findIndex(
        (count, index) =>
          count === leastUsed
          && (clips.length === 1 || index !== previousClipIndex),
      );
    }

    usage[clipIndex] += 1;
    previousClipIndex = clipIndex;
    return clipIndex;
  });
}

export function resolveAvailableStitchSequence(
  requestedSequence: number[],
  availableSourceIndexes: number[],
  totalClipCount: number,
): number[] {
  if (availableSourceIndexes.length === 0 || totalClipCount <= 0) return [];
  const available = [...availableSourceIndexes].sort((a, b) => a - b);
  const availableSet = new Set(available);
  const usage = new Map(available.map((sourceIndex) => [sourceIndex, 0]));
  let previousSourceIndex = -1;

  return requestedSequence.map((sourceIndex) => {
    const normalizedIndex = ((sourceIndex % totalClipCount) + totalClipCount) % totalClipCount;
    let resolved = availableSet.has(normalizedIndex) ? normalizedIndex : -1;
    if (resolved < 0 || (available.length > 1 && resolved === previousSourceIndex)) {
      resolved = available
        .filter((candidate) => available.length === 1 || candidate !== previousSourceIndex)
        .sort((a, b) => (usage.get(a) ?? 0) - (usage.get(b) ?? 0) || a - b)[0]!;
    }
    usage.set(resolved, (usage.get(resolved) ?? 0) + 1);
    previousSourceIndex = resolved;
    return resolved;
  });
}