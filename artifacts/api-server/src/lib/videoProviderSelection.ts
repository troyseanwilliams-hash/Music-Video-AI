import { klingDirectAvailable } from "./videoApis.js";

/**
 * Resolves only a newly-created job's stored provider. Persisted `kling` jobs
 * must remain gateway-backed forever; this helper is intentionally called at
 * the create boundary, never while processing an existing job.
 */
export function resolveNewJobVideoProvider(provider?: string | null): "kling" | "kling_direct" | "runway" {
  const selected = (provider ?? "").trim().toLowerCase();
  if (selected === "kling") {
    return process.env.KLING_DIRECT_NEW_JOBS === "true" && klingDirectAvailable()
      ? "kling_direct"
      : "kling";
  }
  return "runway";
}