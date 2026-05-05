import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  pgEnum,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const jobStatusEnum = pgEnum("job_status", [
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
  removeWatermark: boolean("remove_watermark").notNull().default(false),
  referenceImagePath: text("reference_image_path"),
  requestedDuration: text("requested_duration").default("full"),
  clipStartTime: real("clip_start_time"),
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

export const videosTable = pgTable("videos", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  jobId: text("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  videoObjectPath: text("video_object_path").notNull(),
  thumbnailObjectPath: text("thumbnail_object_path"),
  title: text("title"),
  durationSeconds: real("duration_seconds"),
  style: videoStyleEnum("style"),
  prompt: text("prompt"),
  shareToken: text("share_token").unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const creditsTable = pgTable("credits", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  creditsRemaining: integer("credits_remaining").notNull().default(10),
  creditsUsed: integer("credits_used").notNull().default(0),
  totalGenerations: integer("total_generations").notNull().default(0),
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

export const insertCreditSchema = createInsertSchema(creditsTable);
export type InsertCredit = z.infer<typeof insertCreditSchema>;
export type Credit = typeof creditsTable.$inferSelect;

export const creditGrantSourceEnum = pgEnum("credit_grant_source", [
  "subscription",
  "topup",
  "trial",
  "admin",
]);

export const creditGrantsTable = pgTable("credit_grants", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  source: creditGrantSourceEnum("source").notNull(),
  creditsGranted: integer("credits_granted").notNull(),
  stripeEventId: text("stripe_event_id").unique(),
  stripeInvoiceId: text("stripe_invoice_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePriceId: text("stripe_price_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CreditGrant = typeof creditGrantsTable.$inferSelect;
