import { describe, expect, it, vi } from "vitest";
import { retryNoChargeOperation } from "./noChargeRetry.js";

describe("retryNoChargeOperation", () => {
  it("retries a recoverable read without invoking a replacement operation", async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error("temporary storage timeout"))
      .mockRejectedValueOnce(new Error("temporary storage timeout"))
      .mockResolvedValue(Buffer.from("saved-video"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await retryNoChargeOperation<Buffer>(() => read(), {
      delaysMs: [2_000, 5_000, 10_000],
      sleep,
    });

    expect(result.toString()).toBe("saved-video");
    expect(read).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 5_000);
  });

  it("stops after the bounded recovery window", async () => {
    const read = vi.fn().mockRejectedValue(new Error("still unavailable"));

    await expect(retryNoChargeOperation(() => read(), {
      delaysMs: [1, 2],
      sleep: async () => {},
    })).rejects.toThrow("still unavailable");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("does not retry a terminal result", async () => {
    const read = vi.fn().mockRejectedValue(new Error("terminal"));

    await expect(retryNoChargeOperation(() => read(), {
      delaysMs: [1, 2],
      sleep: async () => {},
      shouldRetry: () => false,
    })).rejects.toThrow("terminal");
    expect(read).toHaveBeenCalledTimes(1);
  });
});