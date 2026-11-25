import { describe, expect, it, vi } from "vitest";
import { deletedEmailHashesTable } from "@workspace/db";
import { hasDeletedEmail, hashEmailForDeletionLedger, recordDeletedEmail } from "./deletedEmails.js";

describe("hashEmailForDeletionLedger", () => {
  it("is deterministic and ignores case and surrounding whitespace", () => {
    const a = hashEmailForDeletionLedger("User@Example.com", "k");
    expect(a).toBe(hashEmailForDeletionLedger("  user@example.com ", "k"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never contains the address and differs per address and per key", () => {
    const a = hashEmailForDeletionLedger("user@example.com", "k");
    expect(a).not.toContain("user");
    expect(a).not.toBe(hashEmailForDeletionLedger("other@example.com", "k"));
    expect(a).not.toBe(hashEmailForDeletionLedger("user@example.com", "different-key"));
  });
});

describe("recordDeletedEmail / hasDeletedEmail", () => {
  it("records the hash (not the address) and tolerates repeats", async () => {
    const onConflictDoNothing = vi.fn(async () => []);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    await recordDeletedEmail({ insert } as never, "User@Example.com");
    expect(insert).toHaveBeenCalledWith(deletedEmailHashesTable);
    const arg = (values.mock.calls[0] as unknown[])[0] as { emailHash: string };
    expect(arg.emailHash).toBe(hashEmailForDeletionLedger("user@example.com"));
    expect(JSON.stringify(arg)).not.toContain("example.com");
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
  });

  it("reports whether a row exists", async () => {
    const make = (rows: unknown[]) => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = async () => rows;
      return { select: () => chain } as never;
    };
    expect(await hasDeletedEmail(make([{ emailHash: "x" }]), "a@b.co")).toBe(true);
    expect(await hasDeletedEmail(make([]), "a@b.co")).toBe(false);
  });
});
