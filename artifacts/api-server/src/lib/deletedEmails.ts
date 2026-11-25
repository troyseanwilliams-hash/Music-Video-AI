import { createHmac } from "node:crypto";
import { deletedEmailHashesTable, type db } from "@workspace/db";
import { eq } from "drizzle-orm";

type Reader = Pick<typeof db, "select">;
type Writer = Pick<typeof db, "insert">;

/**
 * Keyed hash of a normalised email. HMAC (keyed with SESSION_SECRET) so a
 * leaked table cannot be reversed by hashing a list of known addresses.
 */
export function hashEmailForDeletionLedger(email: string, secret = process.env.SESSION_SECRET ?? ""): string {
  const normalized = email.trim().toLowerCase();
  return createHmac("sha256", secret).update(`deleted-email:v1:${normalized}`).digest("hex");
}

/** Remember that this address belonged to an account the user closed. Idempotent. */
export async function recordDeletedEmail(exec: Writer, email: string): Promise<void> {
  await exec
    .insert(deletedEmailHashesTable)
    .values({ emailHash: hashEmailForDeletionLedger(email) })
    .onConflictDoNothing();
}

/** True when this address previously belonged to a closed account. */
export async function hasDeletedEmail(exec: Reader, email: string): Promise<boolean> {
  const rows = await exec
    .select({ emailHash: deletedEmailHashesTable.emailHash })
    .from(deletedEmailHashesTable)
    .where(eq(deletedEmailHashesTable.emailHash, hashEmailForDeletionLedger(email)))
    .limit(1);
  return rows.length > 0;
}
