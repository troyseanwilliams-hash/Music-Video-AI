import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  pgEnum,
  boolean,
  index,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const jobStatusEnum = pgEnum("job_status", [
  "pending_approval",
  "queued",
  "analyzing",
  "generating",
  "stitching",
  "ready",
  "failed",
]);

export const audioSourceTypeEnum = pgEnum("audio_source_type", [
  "upload",
  "youtube",
  "suno",
]);

// Distinguishes AI-generated jobs from user-driven Studio (editor) renders and
// lightweight remix jobs (regenerate a subset of an existing video's clips).
// "runway_lipsync" = the admin-only Runway Lip Sync Generator: a single,
// audio-driven character render, direct-Runway-only, no fallback to any
// other provider. See jobProcessor.ts processRunwayLipSyncJob.
export const jobTypeEnum = pgEnum("job_type", [
  "ai",
  "editor_render",
  "remix",
  "runway_lipsync",
  "image_pack",
  "preview_backfill",
  "podcast",
]);

export const videoStyleEnum = pgEnum("video_style", [
  "realistic",
  "anime",
  "cinematic",
  "abstract",
  "neon",
  "vintage",
  "fantasy",
  "documentary",
]);

export const jobsTable = pgTable("jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // "ai" = the AI generation pipeline; "editor_render" = a Studio timeline render.
  jobType: jobTypeEnum("job_type").notNull().default("ai"),
  // Studio render manifest (ordered segments, music, transition). Null for AI jobs.
  manifest: jsonb("manifest"),
  status: jobStatusEnum("status").notNull().default("queued"),
  audioSourceType: audioSourceTypeEnum("audio_source_type"),
  audioObjectPath: text("audio_object_path"),
  audioSourceUrl: text("audio_source_url"),
  prompt: text("prompt"),
  style: videoStyleEnum("style"),
  audioAnalysis: jsonb("audio_analysis"),
  progressPercent: integer("progress_percent"),
  errorMessage: text("error_message"),
  videoId: text("video_id"),
  lyricsText: text("lyrics_text"),
  aspectRatio: text("aspect_ratio"),
  resolution: text("resolution"),
  character: text("character"),
  referenceImagePath: text("reference_image_path"),
  requestedDuration: text("requested_duration").default("full"),
  clipStartTime: real("clip_start_time"),
  aiProvider: text("ai_provider"),
  // Burn an "AIBeatSync" watermark on the finished video (Starter tier exports).
  watermark: boolean("watermark").notNull().default(false),
  retryCount: integer("retry_count").notNull().default(0),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Cross-process capacity gates for expensive external resources.  A row is a
// numbered slot rather than a lock held by a database connection: callers
// renew its short TTL while doing work, so a stopped process is recovered
// automatically without holding a transaction across a network call.
export const resourceLeasesTable = pgTable(
  "resource_leases",
  {
    resourceKey: text("resource_key").notNull(),
    slot: integer("slot").notNull(),
    ownerToken: text("owner_token").notNull(),
    jobId: text("job_id"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    resourceSlotUnique: uniqueIndex("resource_leases_resource_slot_unique").on(
      table.resourceKey,
      table.slot,
    ),
    expiryIndex: index("resource_leases_expires_at_idx").on(table.expiresAt),
    resourceExpiryIndex: index("resource_leases_resource_expires_at_idx").on(
      table.resourceKey,
      table.expiresAt,
    ),
    jobIndex: index("resource_leases_job_id_idx").on(table.jobId),
  }),
);

export type ResourceLease = typeof resourceLeasesTable.$inferSelect;

export const videosTable = pgTable("videos", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  jobId: text("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  videoObjectPath: text("video_object_path").notNull(),
  // Lower-bitrate fast-start rendition used only for in-browser playback.
  // Downloads always use videoObjectPath so the master remains untouched.
  previewObjectPath: text("preview_object_path"),
  thumbnailObjectPath: text("thumbnail_object_path"),
  title: text("title"),
  durationSeconds: real("duration_seconds"),
  style: videoStyleEnum("style"),
  prompt: text("prompt"),
  // Per-clip metadata captured during generation so individual clips can be
  // remixed (regenerated) later without rerunning the whole pipeline. Array of
  // VideoClipMeta: { index, startTime, endTime, durationSec, prompt, style, objectPath }.
  clips: jsonb("clips"),
  // Auto-cut vertical teaser clips for TikTok/Shorts. Array of TeaserMeta:
  // { index, objectPath, startTime, durationSec }. Null until generated.
  teasers: jsonb("teasers"),
  shareToken: text("share_token").unique(),
  // False for videos rendered via the "no audio" Generate option — a silent,
  // beat-synced-to-nothing video meant to have a soundtrack added later in the
  // Editor (Remix Lab). True (default) for every normal audio-driven render.
  hasAudio: boolean("has_audio").notNull().default(true),
  // Public gallery: opt-in visibility + denormalized like count for fast sorting.
  isPublic: boolean("is_public").notNull().default(false),
  // Per-post privacy control. When true, public feeds must never expose the
  // owner's stored profile name.
  isCreatorAnonymous: boolean("is_creator_anonymous").notNull().default(false),
  likeCount: integer("like_count").notNull().default(0),
  // Soft delete: when set, the user has deleted this video. It's hidden from all
  // user-facing views but remains visible to admins until permanently purged
  // (manually by an admin, or automatically after the retention window).
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Podcast jobs intentionally have their own result record: unlike music-video
// renders they retain a searchable transcript and editorial metadata rather
// than pretending those fields are part of a generic video.
export const podcastJobsTable = pgTable("podcast_jobs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().unique().references(() => jobsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  durationSeconds: real("duration_seconds"),
  transcript: text("transcript"),
  // AssemblyAI word timings retained for deterministic caption re-renders.
  transcriptTimings: jsonb("transcript_timings"),
  providerTranscriptId: text("provider_transcript_id"),
  // Durable checkpoint: retries resume provider polling or local assembly.
  processingStage: text("processing_stage").notNull().default("queued"),
  retryCount: integer("retry_count").notNull().default(0),
  highlights: jsonb("highlights"),
  fullVideoPath: text("full_video_path"),
  previewPath: text("preview_path"),
  thumbnailPath: text("thumbnail_path"),
  clipPaths: jsonb("clip_paths"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  ownerCreatedIndex: index("podcast_jobs_owner_created_idx").on(table.userId, table.createdAt),
}));

export type PodcastJob = typeof podcastJobsTable.$inferSelect;

// Reusable AI-generated stills. These are intentionally separate from videos:
// users can create a visual library first, then arrange the images in Remix Lab
// without running an image-to-video render.
export const imageAssetsTable = pgTable(
  "image_assets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    assetIndex: integer("asset_index").notNull(),
    objectPath: text("object_path").notNull(),
    prompt: text("prompt").notNull(),
    style: videoStyleEnum("style"),
    // Generated images are private Remix inputs until their owner explicitly
    // publishes them. Public responses must never include prompt.
    isPublic: boolean("is_public").notNull().default(false),
    isCreatorAnonymous: boolean("is_creator_anonymous").notNull().default(false),
    likeCount: integer("like_count").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    oneAssetPerJobPosition: uniqueIndex("image_assets_job_index_unique").on(
      table.jobId,
      table.assetIndex,
    ),
  }),
);

// Per-user likes on public generated images. Composite PK makes like/unlike
// idempotent and keeps the denormalized counter safe from duplicate requests.
export const imageAssetLikesTable = pgTable(
  "image_asset_likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    imageAssetId: text("image_asset_id")
      .notNull()
      .references(() => imageAssetsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.imageAssetId] }),
  }),
);

export type ImageAssetLike = typeof imageAssetLikesTable.$inferSelect;

// Per-user likes on public videos. Composite PK prevents double-counting.
export const videoLikesTable = pgTable(
  "video_likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => videosTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.videoId] }),
  }),
);

export type VideoLike = typeof videoLikesTable.$inferSelect;

// AI-generated instrumental "Soundtracks". Persisted so each user has a library
// they can replay, download, reuse in a video, delete, or share/make public.
export const soundtracksTable = pgTable("soundtracks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title"),
  prompt: text("prompt"),
  // Lyrics used for a vocal song (null for instrumentals). hasVocals marks a
  // full MiniMax vocal track vs an instrumental.
  lyrics: text("lyrics"),
  hasVocals: boolean("has_vocals").notNull().default(false),
  // Object-storage path to the audio file (feed straight into the video generator).
  objectPath: text("object_path").notNull(),
  ext: text("ext").notNull().default("mp3"),
  durationSeconds: integer("duration_seconds"),
  // Set when the clip was looped (via ffmpeg) to a longer length; null otherwise.
  loopedToSeconds: integer("looped_to_seconds"),
  provider: text("provider"),
  // Public gallery / share-by-link, mirroring videosTable.
  isPublic: boolean("is_public").notNull().default(false),
  // Per-post privacy control. Public feeds must not expose the owner's profile
  // name while this is enabled.
  isCreatorAnonymous: boolean("is_creator_anonymous").notNull().default(false),
  likeCount: integer("like_count").notNull().default(0),
  shareToken: text("share_token").unique(),
  // Soft delete: hidden from the user's library but retained for the admin.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertSoundtrackSchema = createInsertSchema(soundtracksTable);
export type InsertSoundtrack = z.infer<typeof insertSoundtrackSchema>;
export type Soundtrack = typeof soundtracksTable.$inferSelect;

// Per-user likes on public soundtracks. Composite PK prevents double-counting.
export const soundtrackLikesTable = pgTable(
  "soundtrack_likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    soundtrackId: text("soundtrack_id")
      .notNull()
      .references(() => soundtracksTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.soundtrackId] }),
  }),
);

export type SoundtrackLike = typeof soundtrackLikesTable.$inferSelect;

export const creditsTable = pgTable("credits", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  // creditsRemaining is the sum of subscriptionCredits + topupCredits and is
  // kept up to date by every grant/consume site so existing callers keep
  // working. New code should prefer the bucketed columns when it needs to
  // distinguish source.
  // New users start their trial with 0 credits — the trial gives access to the
  // free features (Prompt Studio builders, free Soundtracks, Remix exports), and
  // credits ("points") are granted only when they subscribe.
  creditsRemaining: integer("credits_remaining").notNull().default(0),
  subscriptionCredits: integer("subscription_credits").notNull().default(0),
  topupCredits: integer("topup_credits").notNull().default(0),
  creditsUsed: integer("credits_used").notNull().default(0),
  totalGenerations: integer("total_generations").notNull().default(0),
  // Free monthly "Soundtracks" (instrumental) allowance usage, reset monthly.
  freeSoundtracksUsed: integer("free_soundtracks_used").notNull().default(0),
  freeSoundtracksResetAt: timestamp("free_soundtracks_reset_at", { withTimezone: true }),
  // One-time introductory vocal song. Kept separate from the recurring
  // instrumental allowance so monthly resets can never restore it.
  freeVocalSongsUsed: integer("free_vocal_songs_used").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertJobSchema = createInsertSchema(jobsTable);
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;

export const insertVideoSchema = createInsertSchema(videosTable);
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;

// Shape of each entry in videosTable.clips. Persisted at generation time and
// read back by the remix pipeline + the remix UI.
export interface VideoClipMeta {
  index: number;
  startTime: number;
  endTime: number;
  durationSec: number;
  prompt: string;
  style: string | null;
  objectPath: string; // /objects/clips/{videoId}/{index}.mp4
}

export const insertCreditSchema = createInsertSchema(creditsTable);
export type InsertCredit = z.infer<typeof insertCreditSchema>;
export type Credit = typeof creditsTable.$inferSelect;

// Saved Studio (editor) projects so users can reopen and re-export a timeline.
export const editorProjectsTable = pgTable("editor_projects", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Untitled project"),
  // Full timeline manifest: { segments: [...], music, transition, transitionDuration, ... }
  manifest: jsonb("manifest").notNull(),
  lastVideoId: text("last_video_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertEditorProjectSchema = createInsertSchema(editorProjectsTable);
export type InsertEditorProject = z.infer<typeof insertEditorProjectSchema>;
export type EditorProject = typeof editorProjectsTable.$inferSelect;

export const ticketCategoryEnum = pgEnum("ticket_category", [
  "billing",
  "technical",
  "content",
  "other",
]);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

export const supportTicketsTable = pgTable("support_tickets", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  category: ticketCategoryEnum("category").notNull().default("other"),
  status: ticketStatusEnum("status").notNull().default("open"),
  jobId: text("job_id"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SupportTicket = typeof supportTicketsTable.$inferSelect;

export const creditGrantSourceEnum = pgEnum("credit_grant_source", [
  "subscription",
  "topup",
  "trial",
  "admin",
  "referral",
]);

export const creditGrantsTable = pgTable("credit_grants", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  source: creditGrantSourceEnum("source").notNull(),
  creditsGranted: integer("credits_granted").notNull(),
  stripeEventId: text("stripe_event_id").unique(),
  stripeInvoiceId: text("stripe_invoice_id").unique(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  stripePriceId: text("stripe_price_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CreditGrant = typeof creditGrantsTable.$inferSelect;

// Share-to-earn referrals. One row per referred signup; unique referred_id
// makes the credit grant idempotent (a user can only ever be referred once).
export const referralsTable = pgTable("referrals", {
  id: text("id").primaryKey(),
  referrerId: text("referrer_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  referredId: text("referred_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  // "credited" once both sides have received their signup credits.
  status: text("status").notNull().default("credited"),
  referrerCredits: integer("referrer_credits").notNull().default(0),
  referredCredits: integer("referred_credits").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Referral = typeof referralsTable.$inferSelect;

// One row per (user, promo code) redemption — enforces "once per user" for
// promos like COMEBACK7. A unique index on (user_id, code) is added in the
// migration.
export const promoRedemptionsTable = pgTable("promo_redemptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
});

// First-party product analytics. One row per tracked event (pageview, time-on-
// page, or a named funnel event). Anonymous visitors are keyed by anonId (a
// localStorage UUID) so we can follow a visitor from first landing through to
// signup; userId is filled in once the request is authenticated. Kept
// deliberately schemaless (meta jsonb) so new events need no migration.
export const analyticsEventsTable = pgTable("analytics_events", {
  id: text("id").primaryKey(),
  // Anonymous, cross-session visitor id (localStorage). Null only for rare
  // server-emitted events.
  anonId: text("anon_id"),
  // Set when the visitor is logged in — links anon activity to a real account.
  userId: text("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  // "pageview" | "page_time" | funnel events ("signup", "checkout_start", ...).
  eventType: text("event_type").notNull(),
  path: text("path"),
  referrer: text("referrer"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  // Milliseconds spent on the page — only set for "page_time" events.
  durationMs: integer("duration_ms"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailCampaignStatusEnum = pgEnum("email_campaign_status", [
  "queued",
  "sending",
  "completed",
]);

export const emailCampaignRecipientStatusEnum = pgEnum("email_campaign_recipient_status", [
  "pending",
  "sending",
  "sent",
  "skipped",
  "failed",
]);

export const emailCampaignsTable = pgTable("email_campaigns", {
  id: text("id").primaryKey(),
  subject: text("subject").notNull(),
  status: emailCampaignStatusEnum("status").notNull().default("queued"),
  batchSize: integer("batch_size").notNull().default(100),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const emailCampaignRecipientsTable = pgTable(
  "email_campaign_recipients",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => emailCampaignsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    position: integer("position").notNull(),
    batchNumber: integer("batch_number").notNull(),
    status: emailCampaignRecipientStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    providerResponse: text("provider_response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    campaignPositionUnique: uniqueIndex("email_campaign_recipients_campaign_position_unique").on(
      table.campaignId,
      table.position,
    ),
    campaignUserUnique: uniqueIndex("email_campaign_recipients_campaign_user_unique").on(
      table.campaignId,
      table.userId,
    ),
    campaignStatusPositionIndex: index("email_campaign_recipients_campaign_status_position_idx").on(
      table.campaignId,
      table.status,
      table.position,
    ),
    campaignBatchStatusIndex: index("email_campaign_recipients_campaign_batch_status_idx").on(
      table.campaignId,
      table.batchNumber,
      table.status,
    ),
    idempotencyKeyUnique: uniqueIndex("email_campaign_recipients_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
  }),
);

export type EmailCampaign = typeof emailCampaignsTable.$inferSelect;
export type EmailCampaignRecipient = typeof emailCampaignRecipientsTable.$inferSelect;

export type AnalyticsEvent = typeof analyticsEventsTable.$inferSelect;
