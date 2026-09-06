import { beforeAll, describe, expect, it } from "vitest";

// @workspace/db validates DATABASE_URL while its module is evaluated. These
// tests always inject the DB boundary, so this value is never connected to.
process.env.DATABASE_URL ??= "postgres://lease-test:lease-test@127.0.0.1:5432/lease_test";

let leases: typeof import("@workspace/db");

beforeAll(async () => {
  leases = await import("@workspace/db");
});

type Reply = { rows: Record<string, unknown>[] };
function database(...replies: Reply[]) {
  let calls = 0;
  return {
    execute: async (): Promise<Reply> => replies[calls++] ?? { rows: [] },
    get calls() { return calls; },
  };
}

describe("PostgreSQL resource leases", () => {
  it("validates bounded resource concurrency environment values", () => {
    expect(leases.resourceLeaseLimits({})).toMatchObject({
      runway_submission: 2,
      assemblyai_submission: 4,
      ffmpeg_heavy: 2,
      object_storage_transfer: 4,
    });
    expect(leases.resourceLeaseLimits({ RUNWAY_SUBMISSION_CONCURRENCY: "3" }).runway_submission).toBe(3);
    expect(() => leases.resourceLeaseLimits({ RUNWAY_SUBMISSION_CONCURRENCY: "0" })).toThrow(/between 1 and 20/);
    expect(() => leases.resourceLeaseLimits({ FFMPEG_LIGHT_CONCURRENCY: "many" })).toThrow(/whole number/);
  });

  it("uses one atomic candidate/upsert statement and accepts only its returned slot", async () => {
    // The production statement uses candidate + INSERT .. ON CONFLICT .. WHERE
    // expired. A concurrent loser receives no RETURNING row from PostgreSQL.
    const winner = database({ rows: [{ slot: 1 }] });
    const loser = database({ rows: [] });
    await expect(leases.tryAcquireResourceLease("runway_submission", { ownerToken: "winner" }, winner)).resolves.toMatchObject({ slot: 1, ownerToken: "winner" });
    await expect(leases.tryAcquireResourceLease("runway_submission", { ownerToken: "loser" }, loser)).resolves.toBeNull();
    expect(winner.calls).toBe(1);
    expect(loser.calls).toBe(1);
  });

  it("allows an expired-slot takeover returned by the atomic DB boundary", async () => {
    const expiredSlotWasClaimed = database({ rows: [{ slot: 2 }] });
    await expect(leases.tryAcquireResourceLease("ffmpeg_heavy", {
      ownerToken: "recovery-owner",
      limit: 2,
    }, expiredSlotWasClaimed)).resolves.toMatchObject({ slot: 2, ownerToken: "recovery-owner" });
  });

  it("requires the exact owner token to renew and release", async () => {
    const lease = { resourceKey: "assemblyai_submission" as const, slot: 1, ownerToken: "token-a" };
    await expect(leases.renewResourceLease(lease, 10_000, database({ rows: [{ slot: 1 }] }))).resolves.toBe(true);
    // PostgreSQL's owner_token predicate produces no row for token-b.
    await expect(leases.renewResourceLease({ ...lease, ownerToken: "token-b" }, 10_000, database({ rows: [] }))).resolves.toBe(false);
    await expect(leases.releaseResourceLease(lease, database({ rows: [{ slot: 1 }] }))).resolves.toBe(true);
    await expect(leases.releaseResourceLease({ ...lease, ownerToken: "token-b" }, database({ rows: [] }))).resolves.toBe(false);
  });

  it("releases its slot after both successful and failed work", async () => {
    const success = database({ rows: [{ slot: 1 }] }, { rows: [{ slot: 1 }] });
    await expect(leases.withResourceLease("other_video_submission", async () => "accepted", {
      database: success,
      pollMs: 50,
    })).resolves.toBe("accepted");
    expect(success.calls).toBe(2); // acquire, release; no polling lease exists

    const failure = database({ rows: [{ slot: 1 }] }, { rows: [{ slot: 1 }] });
    await expect(leases.withResourceLease("other_video_submission", async () => {
      throw new Error("provider rejected");
    }, { database: failure, pollMs: 50 })).rejects.toThrow("provider rejected");
    expect(failure.calls).toBe(2); // release still occurs in finally
  });

  it("heartbeats while bounded waiting and promptly aborts on claim loss", async () => {
    const unavailable = database({ rows: [] });
    let heartbeats = 0;
    await expect(leases.withResourceLease("ffmpeg_heavy", async () => undefined, {
      database: unavailable,
      waitMs: 1_000,
      pollMs: 50,
      heartbeat: async () => {
        heartbeats++;
        if (heartbeats === 2) throw new Error("job claim lost");
      },
    })).rejects.toThrow("job claim lost");
    expect(heartbeats).toBe(2);

    await expect(leases.withResourceLease("ffmpeg_heavy", async () => undefined, {
      database: unavailable,
      shouldAbort: () => true,
    })).rejects.toBeInstanceOf(leases.ResourceLeaseWaitAbortedError);
  });

  it("aborts in-flight work when renewal loses ownership or the renewal DB call fails", async () => {
    const waitForAbort = (signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const ownershipLost = database(
      { rows: [{ slot: 1 }] }, // acquire
      { rows: [] }, // renewal's exact-token UPDATE returned no row
      { rows: [{ slot: 1 }] }, // token-safe release
    );
    await expect(leases.withResourceLease("ffmpeg_heavy", ({ signal }) => waitForAbort(signal), {
      database: ownershipLost, ttlMs: 1_000,
    })).rejects.toThrow("Resource lease ownership was lost");

    let calls = 0;
    const renewalFailure = {
      execute: async (): Promise<Reply> => {
        calls++;
        if (calls === 1) return { rows: [{ slot: 1 }] };
        if (calls === 2) throw new Error("database restart");
        return { rows: [{ slot: 1 }] };
      },
    };
    await expect(leases.withResourceLease("ffmpeg_heavy", ({ signal }) => waitForAbort(signal), {
      database: renewalFailure, ttlMs: 1_000,
    })).rejects.toThrow("database restart");
  });
});