import { Router } from "express";
import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  nextDailyCampaignRunAt,
  usersTable,
} from "@workspace/db";
import {
  GENERATE_VIDEO_CAMPAIGN_ID,
  GENERATE_VIDEO_CAMPAIGN_SUBJECT,
} from "../lib/emailTemplates.js";

const router = Router();
const ALREADY_SENT_COUNT = 100;
const BATCH_SIZE = 100;

function isAdmin(email: string | null | undefined): boolean {
  return !!(process.env.ADMIN_EMAIL && email && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
}

function requireAdmin(req: { isAuthenticated(): boolean; user?: { email?: string | null } }, res: { status(code: number): { json(body: unknown): void } }): boolean {
  if (!req.isAuthenticated() || !isAdmin(req.user?.email)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

router.post("/admin/email-campaigns/generate-video/queue", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: emailCampaignsTable.id,
        status: emailCampaignsTable.status,
        nextRunAt: emailCampaignsTable.nextRunAt,
      })
      .from(emailCampaignsTable)
      .where(eq(emailCampaignsTable.id, GENERATE_VIDEO_CAMPAIGN_ID))
      .limit(1);
    if (existing) {
      return { created: false, existing };
    }

    const users = await tx
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(
        and(
          isNotNull(usersTable.email),
          eq(usersTable.isDisabled, false),
          eq(usersTable.notifyOnComplete, true),
        ),
      )
      .orderBy(asc(usersTable.createdAt), asc(usersTable.id));

    const nextRunAt = nextDailyCampaignRunAt();
    const pendingCount = Math.max(0, users.length - ALREADY_SENT_COUNT);
    const status = pendingCount > 0 ? "queued" : "completed";
    await tx.insert(emailCampaignsTable).values({
      id: GENERATE_VIDEO_CAMPAIGN_ID,
      subject: GENERATE_VIDEO_CAMPAIGN_SUBJECT,
      status,
      batchSize: BATCH_SIZE,
      nextRunAt,
      ...(status === "completed" ? { completedAt: new Date() } : {}),
    });

    if (users.length > 0) {
      await tx.insert(emailCampaignRecipientsTable).values(
        users.map((user, position) => {
          const recipientStatus: "sent" | "pending" =
            position < ALREADY_SENT_COUNT ? "sent" : "pending";
          return {
            id: randomUUID(),
            campaignId: GENERATE_VIDEO_CAMPAIGN_ID,
            userId: user.id,
            email: user.email!,
            position,
            batchNumber: Math.floor(position / BATCH_SIZE),
            status: recipientStatus,
            sentAt: position < ALREADY_SENT_COUNT ? new Date() : null,
            idempotencyKey: `${GENERATE_VIDEO_CAMPAIGN_ID}-recipient-${user.id}`,
          };
        }),
      );
    }

    return {
      created: true,
      campaignId: GENERATE_VIDEO_CAMPAIGN_ID,
      recordedSentRecipients: Math.min(ALREADY_SENT_COUNT, users.length),
      queuedRecipients: pendingCount,
      nextRunAt,
    };
  });

  res.status(result.created ? 201 : 409).json(result);
});

router.get("/admin/email-campaigns/generate-video", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const [campaign] = await db
    .select()
    .from(emailCampaignsTable)
    .where(eq(emailCampaignsTable.id, GENERATE_VIDEO_CAMPAIGN_ID))
    .limit(1);
  if (!campaign) {
    res.status(404).json({ error: "Campaign is not queued" });
    return;
  }

  const counts = await db
    .select({
      status: emailCampaignRecipientsTable.status,
      count: count(),
    })
    .from(emailCampaignRecipientsTable)
    .where(eq(emailCampaignRecipientsTable.campaignId, GENERATE_VIDEO_CAMPAIGN_ID))
    .groupBy(emailCampaignRecipientsTable.status);

  res.json({
    campaign: {
      id: campaign.id,
      status: campaign.status,
      nextRunAt: campaign.nextRunAt,
      lastRunAt: campaign.lastRunAt,
      completedAt: campaign.completedAt,
      lastError: campaign.lastError,
    },
    counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])),
  });
});

export default router;