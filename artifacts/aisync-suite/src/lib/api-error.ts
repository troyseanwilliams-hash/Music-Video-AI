export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;

  const data = "data" in error ? error.data : undefined;
  if (!data || typeof data !== "object") return fallback;

  const message = "error" in data ? data.error : undefined;
  return typeof message === "string" && message.trim() ? message : fallback;
}