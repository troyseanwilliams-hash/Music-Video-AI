import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSEMBLY_DEADLINE_EXCEEDED,
  createJobRunSupervisor,
} from "./jobRunSupervisor.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("job run supervisor", () => {
  it("aborts with the deadline reason and clears its timers", () => {
    vi.useFakeTimers();
    const supervisor = createJobRunSupervisor({
      assertOwned: vi.fn(async () => {}),
      isOwnershipLost: () => false,
      ownershipIntervalMs: 1_000,
      assemblyDeadlineMs: 60 * 60_000,
    });

    supervisor.startAssemblyDeadline();
    vi.advanceTimersByTime(60 * 60_000);

    expect(supervisor.signal.aborted).toBe(true);
    expect((supervisor.signal.reason as Error).message).toBe(ASSEMBLY_DEADLINE_EXCEEDED);
    supervisor.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels on lost ownership without overlapping checks", async () => {
    vi.useFakeTimers();
    let rejectFirst!: (error: Error) => void;
    const assertOwned = vi.fn(
      () => new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      }),
    );
    const supervisor = createJobRunSupervisor({
      assertOwned,
      isOwnershipLost: (error) => error instanceof Error && error.message.includes("ownership lost"),
      ownershipIntervalMs: 1_000,
      assemblyDeadlineMs: 60 * 60_000,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(assertOwned).toHaveBeenCalledTimes(1);
    rejectFirst(new Error("ownership lost"));
    await Promise.resolve();

    expect(supervisor.signal.aborted).toBe(true);
    expect((supervisor.signal.reason as Error).message).toBe("ownership lost");
    supervisor.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});