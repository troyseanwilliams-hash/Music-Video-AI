import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  passwordHash: varchar("password_hash"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  subscriptionStatus: varchar("subscription_status").notNull().default("none"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  membershipExpiresAt: timestamp("membership_expires_at", { withTimezone: true }),
  mediaRetentionStartedAt: timestamp("media_retention_started_at", { withTimezone: true }),
  mediaRetentionNoticeSentAt: timestamp("media_retention_notice_sent_at", { withTimezone: true }),
  mediaRetentionDeletedAt: timestamp("media_retention_deleted_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // Client IP captured at registration — used to limit multiple free-trial
  // accounts from the same network.
  signupIp: varchar("signup_ip"),
  isDisabled: boolean("is_disabled").notNull().default(false),
  // Timestamp of the user's most recent copyright/ownership attestation.
  copyrightAcceptedAt: timestamp("copyright_accepted_at", { withTimezone: true }),
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  // Short-lived mutex shared by standalone and Suite subscription checkout.
  // Stripe lifecycle webhooks clear it after the subscription is authoritative.
  billingCheckoutPendingUntil: timestamp("billing_checkout_pending_until", {
    withTimezone: true,
  }),
  // Share-to-earn: this user's shareable referral code (generated lazily on
  // first visit to the Refer & Earn panel).
  referralCode: varchar("referral_code").unique(),
  // Password reset: sha256 hash of the emailed token + its expiry.
  passwordResetToken: varchar("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires", { withTimezone: true }),
  // Free AssemblyAI auto-sync alignments consumed during the 7-day trial
  // (trial users get a small free allowance; see lyrics.ts).
  trialAlignsUsed: integer("trial_aligns_used").notNull().default(0),
  // Render-finished email notifications (opt-out).
  notifyOnComplete: boolean("notify_on_complete").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
