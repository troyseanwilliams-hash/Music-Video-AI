import { boolean, integer, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const twoFactorTable = pgTable("user_two_factor", {
  userId: varchar("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  encryptedSecret: varchar("encrypted_secret").notNull(),
  pendingExpiresAt: timestamp("pending_expires_at", { withTimezone: true }),
  lastUsedStep: integer("last_used_step").notNull().default(-1),
  recoveryHashes: jsonb("recovery_hashes").$type<string[]>().notNull().default([]),
});

// Shared across API replicas; never rely on an in-memory OTP attempt counter.
export const authRateLimitsTable = pgTable("auth_rate_limits", {
  key: varchar("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});
