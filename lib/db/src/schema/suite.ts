/**
 * Suite schema — cross-product linking between AIBeatSync and AIPodSync.
 *
 * Design:
 * - suite_links: one per (aibeat_user, aipod_user) pairing
 * - suite_link_codes: short-lived PKCE exchange codes (hash at rest)
 * - suite_subscriptions: central subscription state per link
 * - suite_outbox_events: durable, at-least-once event delivery to AIPodSync
 */
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./auth";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const suiteOutboxEventStatusEnum = pgEnum("suite_outbox_event_status", [
  "pending",
  "delivered",
  "failed",
]);

export const suiteSubscriptionStatusEnum = pgEnum(
  "suite_subscription_status",
  ["none", "active", "past_due", "cancelled"],
);

// ─── suite_links ─────────────────────────────────────────────────────────────
// One row per linked (AIBeat user, AIPod user) pair.
// deliveryTokenHash: SHA-256 of the random per-link token returned at finalize.
//   AIPodSync holds the raw token; we only store its hash.
export const suiteLinksTable = pgTable(
  "suite_links",
  {
    id: text("id").primaryKey(),
    // AIBeatSync side
    aibeatUserId: text("aibeat_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // AIPodSync side (set at finalize)
    aipodUserId: text("aipod_user_id"),
    aipodWalletId: text("aipod_wallet_id"),
    // Per-link delivery token — hashed, never stored raw
    deliveryTokenHash: text("delivery_token_hash").unique(),
    // State of the subscription associated with this link
    subscriptionStatus: suiteSubscriptionStatusEnum("subscription_status")
      .notNull()
      .default("none"),
    // Stripe subscription ID for the Suite sub associated with this link
    stripeSubscriptionId: text("stripe_subscription_id"),
    // Which product originated the checkout (aibeatsync | aipodsync)
    checkoutOrigin: text("checkout_origin"),
    // Short reservation used to prevent concurrent Checkout Sessions. Stripe
    // Sessions use the same expiry, so a cancelled/abandoned attempt unlocks
    // automatically without creating overlapping subscriptions.
    checkoutPendingUntil: timestamp("checkout_pending_until", {
      withTimezone: true,
    }),
    // AIPod direct-status mirror (populated at finalize, updated via source-status)
    aipodDirectStatus: text("aipod_direct_status"),
    // Distributed checkout reservation set by AIPod before it opens a direct
    // Stripe Session. Suite checkout and this reservation are mutually
    // exclusive on the AIBeat authority.
    aipodDirectPendingUntil: timestamp("aipod_direct_pending_until", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_suite_links_aibeat_user").on(t.aibeatUserId),
    index("idx_suite_links_aipod_user").on(t.aipodUserId),
    uniqueIndex("uq_suite_links_active_aibeat_user")
      .on(t.aibeatUserId)
      .where(sql`${t.aipodUserId} is not null`),
    uniqueIndex("uq_suite_links_active_aipod_user")
      .on(t.aipodUserId)
      .where(sql`${t.aipodUserId} is not null`),
    uniqueIndex("uq_suite_links_active_aipod_wallet")
      .on(t.aipodWalletId)
      .where(sql`${t.aipodWalletId} is not null`),
  ],
);

export type SuiteLink = typeof suiteLinksTable.$inferSelect;

// ─── suite_link_codes ────────────────────────────────────────────────────────
// Short-lived PKCE-style one-time codes. Codes themselves are never stored — we
// store their SHA-256 hash. codeChallengeHash stores the SHA-256 of the
// code_challenge sent by AIPodSync; we re-derive it at exchange time to verify.
export const suiteLinkCodesTable = pgTable(
  "suite_link_codes",
  {
    id: text("id").primaryKey(),
    // The link row being built (created at authorize time)
    linkId: text("link_id")
      .notNull()
      .references(() => suiteLinksTable.id, { onDelete: "cascade" }),
    // SHA-256(code) stored at rest; never the raw code
    codeHash: text("code_hash").notNull().unique(),
    // SHA-256(codeChallenge) as sent by AIPodSync at authorize
    codeChallengeHash: text("code_challenge_hash").notNull(),
    // SHA-256(verifier) recomputed at exchange and compared to codeChallengeHash
    // i.e. we verify: SHA256(verifier) == codeChallengeHash
    // Random state echoed back in the redirect
    state: text("state").notNull(),
    // Allowlisted return URL
    returnUrl: text("return_url").notNull(),
    // One-time: consumed once exchanged
    usedAt: timestamp("used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_suite_link_codes_link").on(t.linkId)],
);

export type SuiteLinkCode = typeof suiteLinkCodesTable.$inferSelect;

// ─── suite_finalize_tokens ───────────────────────────────────────────────────
// One-time finalize tokens issued at /suite/link/exchange.
// Raw token is returned to AIPodSync; only the hash is stored here.
export const suiteFinalizeTokensTable = pgTable(
  "suite_finalize_tokens",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id")
      .notNull()
      .references(() => suiteLinksTable.id, { onDelete: "cascade" }),
    // SHA-256(finalizeToken)
    tokenHash: text("token_hash").notNull().unique(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_suite_finalize_tokens_link").on(t.linkId)],
);

export type SuiteFinalizeToken = typeof suiteFinalizeTokensTable.$inferSelect;

// ─── suite_subscriptions ─────────────────────────────────────────────────────
// Central subscription state per link — one row per linkId.
export const suiteSubscriptionsTable = pgTable(
  "suite_subscriptions",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id")
      .notNull()
      .references(() => suiteLinksTable.id, { onDelete: "cascade" })
      .unique(),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    stripePriceId: text("stripe_price_id"),
    // e.g. "suite_creator_monthly"
    priceLookupKey: text("price_lookup_key"),
    status: suiteSubscriptionStatusEnum("status").notNull().default("none"),
    // AIBeat credits allotment for this plan
    aibeatCredits: integer("aibeat_credits").notNull().default(0),
    // AIPod credits allotment for this plan
    aipodCredits: integer("aipod_credits").notNull().default(0),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type SuiteSubscription = typeof suiteSubscriptionsTable.$inferSelect;

// ─── suite_outbox_events ──────────────────────────────────────────────────────
// Durable outbox for events that must be delivered to AIPodSync.
// eventKey is a globally unique key (e.g. "invoice.<id>.credits.grant") that
// prevents duplicate rows from being created.
export const suiteOutboxEventsTable = pgTable(
  "suite_outbox_events",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id")
      .notNull()
      .references(() => suiteLinksTable.id, { onDelete: "cascade" }),
    // Globally unique key — ensures idempotent inserts
    eventKey: text("event_key").notNull().unique(),
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull(), // JSON string
    status: suiteOutboxEventStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_suite_outbox_link").on(t.linkId),
    index("idx_suite_outbox_status").on(t.status),
  ],
);

export type SuiteOutboxEvent = typeof suiteOutboxEventsTable.$inferSelect;
