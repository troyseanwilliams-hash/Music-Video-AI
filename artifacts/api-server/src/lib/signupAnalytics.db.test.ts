/**
 * Optional development-database integration coverage for the transaction
 * boundary. It is skipped unless both opt-in variables are supplied:
 *
 *   SIGNUP_ANALYTICS_DB_TARGET=development
 *   SIGNUP_ANALYTICS_DB_URL=<isolated development DATABASE_URL>
 *
 * The test inserts a synthetic user/event and deliberately rolls back. It
 * never targets production by default and leaves no persistent test records.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildSignupCompletedEvent, signupCompletedEventId } from "./signupAnalytics.js";

const developmentDatabaseUrl =
  process.env.SIGNUP_ANALYTICS_DB_TARGET === "development"
    ? process.env.SIGNUP_ANALYTICS_DB_URL
    : undefined;

const runIntegrationTest = Boolean(developmentDatabaseUrl);

// Import only after selecting the explicit opt-in URL. In normal unit-test
// runs this module still uses the harmless placeholder URL from vitest.config.
if (developmentDatabaseUrl) {
  process.env.DATABASE_URL = developmentDatabaseUrl;
}

const realDb = await import("@workspace/db");

afterAll(async () => {
  if (runIntegrationTest) await realDb.pool.end();
});

describe.skipIf(!runIntegrationTest)("signup transaction on development PostgreSQL", () => {
  it("rolls back both account and completion event together", async () => {
    const userId = `signup-analytics-test-${randomUUID()}`;
    const email = `${userId}@invalid.test`;
    const eventId = signupCompletedEventId(userId);

    await expect(
      realDb.db.transaction(async (tx) => {
        await tx.insert(realDb.usersTable).values({
          id: userId,
          email,
          subscriptionStatus: "trial",
        });
        await tx.insert(realDb.analyticsEventsTable).values(
          buildSignupCompletedEvent(userId, {
            source: "direct",
            anonId: null,
          }),
        );
        throw new Error("intentional signup transaction rollback");
      }),
    ).rejects.toThrow("intentional signup transaction rollback");

    const users = await realDb.db
      .select({ id: realDb.usersTable.id })
      .from(realDb.usersTable)
      .where(eq(realDb.usersTable.id, userId));
    const events = await realDb.db
      .select({ id: realDb.analyticsEventsTable.id })
      .from(realDb.analyticsEventsTable)
      .where(eq(realDb.analyticsEventsTable.id, eventId));

    expect(users).toEqual([]);
    expect(events).toEqual([]);
  });
});