export type NoChargeRetryOptions = {
  delaysMs: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, nextAttempt: number, delayMs: number) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries only the supplied read/poll operation. Callers must never include a
 * provider submission or credit mutation inside this operation.
 */
export async function retryNoChargeOperation<T>(
  operation: (attempt: number) => Promise<T>,
  options: NoChargeRetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 1;
  for (;;) {
    try {
      return await operation(attempt);
    } catch (error) {
      const delayMs = options.delaysMs[attempt - 1];
      if (delayMs === undefined || options.shouldRetry?.(error) === false) {
        throw error;
      }
      options.onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}