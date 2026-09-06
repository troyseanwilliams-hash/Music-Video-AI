export interface SceneConcurrencyOptions {
  requested?: string | number | null;
  forceSequential?: boolean;
}

export function resolveSceneConcurrency(options: SceneConcurrencyOptions = {}): number {
  if (options.forceSequential) return 1;
  const parsed = Number(options.requested ?? 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(3, Math.floor(parsed)));
}

export function pendingFirstOrder(
  indexes: readonly number[],
  pendingRequests: Readonly<Record<string, string>>,
): number[] {
  return [
    ...indexes.filter((index) => Boolean(pendingRequests[index])),
    ...indexes.filter((index) => !pendingRequests[index]),
  ];
}

export async function runBoundedScenes<T>(
  indexes: readonly number[],
  concurrency: number,
  operation: (index: number) => Promise<T>,
  shouldStart: () => boolean = () => true,
  onStop: (error: unknown) => void = () => {},
): Promise<T[]> {
  const results = new Array<T>(indexes.length);
  let cursor = 0;
  let stopped = false;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopped || !shouldStart()) return;
      const position = cursor++;
      if (position >= indexes.length) return;
      try {
        results[position] = await operation(indexes[position]!);
      } catch (error) {
        stopped = true;
        firstError ??= error;
        onStop(error);
        return;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(resolveSceneConcurrency({ requested: concurrency }), indexes.length) }, worker),
  );
  if (firstError !== undefined) throw firstError;
  return results;
}

export interface LazyBuffer {
  buffer: Buffer;
  loadBuffer?: () => Promise<Buffer>;
}

export function lazyBuffer(loadBuffer: () => Promise<Buffer>): LazyBuffer {
  return { buffer: undefined as unknown as Buffer, loadBuffer };
}

export async function materializeLazyBuffers<T extends LazyBuffer>(clips: T[]): Promise<T[]> {
  await runBoundedScenes(clips.map((_, index) => index), 3, async (index) => {
    const clip = clips[index]!;
    if (!clip.buffer && clip.loadBuffer) {
      clip.buffer = await clip.loadBuffer();
      delete clip.loadBuffer;
    }
  });
  return clips;
}