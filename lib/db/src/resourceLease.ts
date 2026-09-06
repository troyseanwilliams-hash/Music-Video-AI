import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { db } from "./index";
import { sql } from "drizzle-orm";

export type ResourceKey =
  | "runway_submission"
  | "gateway_video_submission"
  | "other_video_submission"
  | "elevenlabs_submission"
  | "elevenlabs"
  | "assemblyai_submission"
  | "ffmpeg_heavy"
  | "ffmpeg_light"
  | "object_storage_transfer"
  | "image_provider_submission";

const definitions: Record<ResourceKey, { env: string; fallback: number; maximum: number }> = {
  runway_submission: { env: "RUNWAY_SUBMISSION_CONCURRENCY", fallback: 2, maximum: 20 },
  gateway_video_submission: { env: "GATEWAY_VIDEO_SUBMISSION_CONCURRENCY", fallback: 2, maximum: 20 },
  other_video_submission: { env: "OTHER_VIDEO_SUBMISSION_CONCURRENCY", fallback: 2, maximum: 20 },
  elevenlabs_submission: { env: "ELEVENLABS_SUBMISSION_CONCURRENCY", fallback: 2, maximum: 20 },
  elevenlabs: { env: "ELEVENLABS_CONCURRENCY", fallback: 2, maximum: 20 },
  assemblyai_submission: { env: "ASSEMBLYAI_SUBMISSION_CONCURRENCY", fallback: 4, maximum: 40 },
  ffmpeg_heavy: { env: "FFMPEG_HEAVY_CONCURRENCY", fallback: 2, maximum: 20 },
  ffmpeg_light: { env: "FFMPEG_LIGHT_CONCURRENCY", fallback: 4, maximum: 40 },
  object_storage_transfer: { env: "OBJECT_STORAGE_TRANSFER_CONCURRENCY", fallback: 4, maximum: 40 },
  image_provider_submission: { env: "IMAGE_PROVIDER_SUBMISSION_CONCURRENCY", fallback: 4, maximum: 40 },
};

/** Read limits at process initialization. Invalid configured values fail fast. */
export function resourceLeaseLimits(env: NodeJS.ProcessEnv = process.env): Record<ResourceKey, number> {
  return Object.fromEntries(
    (Object.keys(definitions) as ResourceKey[]).map((key) => {
      const definition = definitions[key];
      const raw = env[definition.env]?.trim();
      if (!raw) return [key, definition.fallback];
      if (!/^\d+$/.test(raw)) {
        throw new Error(`${definition.env} must be a whole number between 1 and ${definition.maximum}`);
      }
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < 1 || value > definition.maximum) {
        throw new Error(`${definition.env} must be a whole number between 1 and ${definition.maximum}`);
      }
      return [key, value];
    }),
  ) as Record<ResourceKey, number>;
}

export const RESOURCE_LEASE_LIMITS = resourceLeaseLimits();
const localWaiters = new Map<ResourceKey, number>();
export type ResourceLeaseExecutionContext = {
  jobId?: string;
  heartbeat?: () => Promise<void>;
  shouldAbort?: () => boolean;
  signal?: AbortSignal;
};
const executionContext = new AsyncLocalStorage<ResourceLeaseExecutionContext>();
export const runWithResourceLeaseExecutionContext = <T>(
  context: ResourceLeaseExecutionContext,
  work: () => Promise<T>,
): Promise<T> => executionContext.run(context, work);
export const getResourceLeaseExecutionContext = (): ResourceLeaseExecutionContext | undefined =>
  executionContext.getStore();

/** Process-local wait visibility; active capacity is obtained durably from DB. */
export function getLocalResourceLeaseWaiters(): Array<{ resourceKey: ResourceKey; waiting: number }> {
  return (Object.keys(definitions) as ResourceKey[])
    .map((resourceKey) => ({ resourceKey, waiting: localWaiters.get(resourceKey) ?? 0 }))
    .filter((entry) => entry.waiting > 0);
}

export interface LeaseDatabase {
  // Deliberately structural so unit tests can supply a small mocked DB boundary.
  execute(query: unknown): Promise<{ rows: Record<string, unknown>[] }>;
}

export type AcquiredLease = {
  resourceKey: ResourceKey;
  slot: number;
  ownerToken: string;
  jobId?: string;
};

export async function tryAcquireResourceLease(
  resourceKey: ResourceKey,
  options: { jobId?: string; ownerToken?: string; ttlMs?: number; limit?: number } = {},
  database: LeaseDatabase = db,
): Promise<AcquiredLease | null> {
  const ownerToken = options.ownerToken ?? randomUUID();
  const ttlMs = Math.max(1_000, Math.min(options.ttlMs ?? 120_000, 30 * 60_000));
  const limit = options.limit ?? RESOURCE_LEASE_LIMITS[resourceKey];
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Resource lease limit must be between 1 and 100");
  const result = await database.execute(sql`
    WITH candidate AS (
      SELECT slots.slot
      FROM generate_series(1, ${limit}) AS slots(slot)
      LEFT JOIN resource_leases leases
        ON leases.resource_key = ${resourceKey} AND leases.slot = slots.slot
      WHERE leases.resource_key IS NULL OR leases.expires_at <= NOW()
      ORDER BY CASE WHEN leases.resource_key IS NULL THEN 0 ELSE 1 END, slots.slot
      LIMIT 1
    )
    INSERT INTO resource_leases
      (resource_key, slot, owner_token, job_id, acquired_at, heartbeat_at, expires_at)
    SELECT ${resourceKey}, candidate.slot, ${ownerToken}, ${options.jobId ?? null},
      NOW(), NOW(), NOW() + (${ttlMs} * INTERVAL '1 millisecond')
    FROM candidate
    ON CONFLICT (resource_key, slot) DO UPDATE
      SET owner_token = EXCLUDED.owner_token, job_id = EXCLUDED.job_id,
        acquired_at = NOW(), heartbeat_at = NOW(), expires_at = EXCLUDED.expires_at
      WHERE resource_leases.expires_at <= NOW()
    RETURNING slot
  `);
  const slot = result.rows[0]?.slot;
  return typeof slot !== "number" ? null : { resourceKey, slot, ownerToken, jobId: options.jobId };
}

export async function renewResourceLease(
  lease: AcquiredLease,
  ttlMs = 120_000,
  database: LeaseDatabase = db,
): Promise<boolean> {
  const result = await database.execute(sql`
    UPDATE resource_leases
    SET heartbeat_at = NOW(), expires_at = NOW() + (${Math.max(1_000, Math.min(ttlMs, 30 * 60_000))} * INTERVAL '1 millisecond')
    WHERE resource_key = ${lease.resourceKey} AND slot = ${lease.slot}
      AND owner_token = ${lease.ownerToken} AND expires_at > NOW()
    RETURNING slot
  `);
  return result.rows.length === 1;
}

export async function releaseResourceLease(
  lease: AcquiredLease,
  database: LeaseDatabase = db,
): Promise<boolean> {
  const result = await database.execute(sql`
    DELETE FROM resource_leases
    WHERE resource_key = ${lease.resourceKey} AND slot = ${lease.slot}
      AND owner_token = ${lease.ownerToken}
    RETURNING slot
  `);
  return result.rows.length === 1;
}

export class ResourceLeaseWaitAbortedError extends Error {
  constructor() { super("Resource lease wait aborted"); this.name = "ResourceLeaseWaitAbortedError"; }
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Acquires a capacity slot with bounded polling. Do not acquire a storage lease
 * while holding another lease; callers should finish provider/FFmpeg work first.
 * `heartbeat` is intentionally called while waiting so job watchdog claims stay
 * live. It may throw to abort on shutdown or claim loss.
 */
export async function withResourceLease<T>(
  resourceKey: ResourceKey,
  work: (context: { signal: AbortSignal; lease: AcquiredLease }) => Promise<T>,
  options: {
    jobId?: string;
    ttlMs?: number;
    waitMs?: number;
    pollMs?: number;
    heartbeat?: () => Promise<void>;
    shouldAbort?: () => boolean;
    signal?: AbortSignal;
    database?: LeaseDatabase;
  } = {},
): Promise<T> {
  const database = options.database ?? db;
  // Provider unit tests deliberately exercise network/request fencing without
  // provisioning PostgreSQL. Explicit injected boundaries still test every
  // lease path below; production never takes this branch.
  if (process.env.NODE_ENV === "test" && database === db) {
    return work({ signal: options.signal ?? new AbortController().signal, lease: { resourceKey, slot: 0, ownerToken: "test" } });
  }
  const inherited = executionContext.getStore();
  const controller = new AbortController();
  const parentSignal = options.signal ?? inherited?.signal;
  const parentAbort = () => controller.abort(parentSignal?.reason ?? new Error("Resource lease parent aborted"));
  if (parentSignal?.aborted) parentAbort();
  else parentSignal?.addEventListener("abort", parentAbort, { once: true });
  const deadline = Date.now() + Math.max(1_000, Math.min(options.waitMs ?? 10 * 60_000, 60 * 60_000));
  const pollMs = Math.max(50, Math.min(options.pollMs ?? 500, 10_000));
  let lease: AcquiredLease | null = null;
  localWaiters.set(resourceKey, (localWaiters.get(resourceKey) ?? 0) + 1);
  try {
    while (!lease) {
      if (options.shouldAbort?.() || inherited?.shouldAbort?.() || controller.signal.aborted) throw new ResourceLeaseWaitAbortedError();
      await (options.heartbeat ?? inherited?.heartbeat)?.();
      lease = await tryAcquireResourceLease(resourceKey, { jobId: options.jobId, ttlMs: options.ttlMs }, database);
      if (!lease) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${resourceKey} capacity`);
        await sleep(pollMs);
      }
    }
  } finally {
    const remaining = (localWaiters.get(resourceKey) ?? 1) - 1;
    if (remaining > 0) localWaiters.set(resourceKey, remaining);
    else localWaiters.delete(resourceKey);
  }
  const renewalMs = Math.max(500, Math.floor((options.ttlMs ?? 120_000) / 2));
  let renewalFailure: unknown;
  const heartbeat = setInterval(() => {
    void renewResourceLease(lease!, options.ttlMs, database).then((renewed) => {
      if (!renewed) {
        renewalFailure = new Error("Resource lease ownership was lost");
        controller.abort(renewalFailure);
      }
    }).catch((error) => {
      renewalFailure = error;
      controller.abort(error);
    });
  }, renewalMs);
  heartbeat.unref?.();
  try {
    const result = await work({ signal: controller.signal, lease });
    if (controller.signal.aborted) throw renewalFailure ?? controller.signal.reason ?? new Error("Resource lease ownership was lost");
    return result;
  } finally {
    clearInterval(heartbeat);
    parentSignal?.removeEventListener("abort", parentAbort);
    await releaseResourceLease(lease, database);
  }
}

export async function getResourceLeaseMetrics(database: LeaseDatabase = db): Promise<Array<{ resourceKey: string; active: number; expired: number }>> {
  const result = await database.execute(sql`
    SELECT resource_key AS "resourceKey",
      COUNT(*) FILTER (WHERE expires_at > NOW())::int AS active,
      COUNT(*) FILTER (WHERE expires_at <= NOW())::int AS expired
    FROM resource_leases GROUP BY resource_key ORDER BY resource_key
  `);
  return result.rows.map((row) => ({
    resourceKey: String(row.resourceKey),
    active: Number(row.active),
    expired: Number(row.expired),
  }));
}