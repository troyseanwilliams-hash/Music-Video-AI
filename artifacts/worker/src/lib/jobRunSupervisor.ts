export const ASSEMBLY_DEADLINE_EXCEEDED = "assembly and storage deadline exceeded";

export type JobRunSupervisor = {
  signal: AbortSignal;
  startAssemblyDeadline(): void;
  throwIfAborted(): void;
  stop(): void;
};

export function createJobRunSupervisor(options: {
  assertOwned: () => Promise<void>;
  isOwnershipLost: (error: unknown) => boolean;
  ownershipIntervalMs: number;
  assemblyDeadlineMs: number;
}): JobRunSupervisor {
  const controller = new AbortController();
  let ownershipCheckRunning = false;
  let stopped = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  const checkOwnership = async () => {
    if (stopped || controller.signal.aborted || ownershipCheckRunning) return;
    ownershipCheckRunning = true;
    try {
      await options.assertOwned();
    } catch (error) {
      if (options.isOwnershipLost(error) && !controller.signal.aborted) {
        controller.abort(error);
      }
    } finally {
      ownershipCheckRunning = false;
    }
  };

  const ownershipTimer = setInterval(() => void checkOwnership(), options.ownershipIntervalMs);
  ownershipTimer.unref?.();

  return {
    signal: controller.signal,
    startAssemblyDeadline() {
      if (deadlineTimer || controller.signal.aborted || stopped) return;
      deadlineTimer = setTimeout(() => {
        if (!controller.signal.aborted) {
          controller.abort(new Error(ASSEMBLY_DEADLINE_EXCEEDED));
        }
      }, options.assemblyDeadlineMs);
      deadlineTimer.unref?.();
    },
    throwIfAborted() {
      controller.signal.throwIfAborted();
    },
    stop() {
      stopped = true;
      clearInterval(ownershipTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
    },
  };
}