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

// Distinguishes AI-generated jobs from user-driven Studio (editor) renders.
export const jobTypeEnum = pgEnum("job_type", ["ai", "editor_render"]);

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
  // creditsRemaining is the sum of subscriptionCredits + topupCredits and is
  // kept up to date by every grant/consume site so existing callers keep
  // working. New code should prefer the bucketed columns when it needs to
  // distinguish source.
  creditsRemaining: integer("credits_remaining").notNull().default(10),
  subscriptionCredits: integer("subscription_credits").notNull().default(10),
  topupCredits: integer("topup_credits").notNull().default(0),
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
