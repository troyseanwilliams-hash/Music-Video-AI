export const INFRASTRUCTURE_RETRY = "[INFRASTRUCTURE_RETRY]";

const TRANSIENT_INFRASTRUCTURE_PATTERN =
  /connection terminated|connection timeout|database.*(?:timeout|unavailable)|Failed query:\s*update\s+"jobs"\s+set\s+"progress_percent"|ECONNRESET|ETIMEDOUT|EPIPE|ENETUNREACH|EAI_AGAIN|socket hang up|TimeoutError|operation was aborted due to timeout|service unavailable|bad gateway/i;

export function isTransientInfrastructureError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const detail = current instanceof Error
      ? `${current.name}: ${current.message}`
      : String(current);
    if (detail.includes(INFRASTRUCTURE_RETRY)) return true;
    if (TRANSIENT_INFRASTRUCTURE_PATTERN.test(detail)) return true;
    current = current instanceof Error
      ? (current as Error & { cause?: unknown }).cause
      : undefined;
  }
  return false;
}

export function recoverableInfrastructureError(error: unknown): Error {
  if (error instanceof Error && error.message.includes(INFRASTRUCTURE_RETRY)) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${INFRASTRUCTURE_RETRY} ${detail}`, { cause: error });
}