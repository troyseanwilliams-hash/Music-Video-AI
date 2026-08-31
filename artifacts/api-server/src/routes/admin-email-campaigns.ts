import { Router } from "express";
import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  tomorrowDailyCampaignRunAt,
  usersTable,
} from "@workspace/db";
import {
  GENERATE_VIDEO_CAMPAIGN_ID,
  GENERATE_VIDEO_CAMPAIGN_SUBJECT,
} from "../lib/emailTemplates.js";

const router = Router();
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

function requireSameOrigin(
  req: { get(name: string): string | undefined },
  res: { status(code: number): { json(body: unknown): void } },
): boolean {
  const origin = req.get("origin");
  const host = req.get("host");
  if (!origin || !host) {
    res.status(403).json({ error: "Same-origin request required" });
    return false;
  }
  try {
    if (new URL(origin).host !== host) {
      res.status(403).json({ error: "Same-origin request required" });
      return false;
    }
  } catch {
    res.status(403).json({ error: "Same-origin request required" });
    return false;
  }
  return true;
}

router.post("/admin/email-campaigns/generate-video/queue", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!requireSameOrigin(req, res)) return;

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
      .orderBy(desc(usersTable.createdAt), desc(usersTable.id))
      .limit(BATCH_SIZE);

    const nextRunAt = tomorrowDailyCampaignRunAt();
    const status = users.length > 0 ? "queued" : "completed";
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
          return {
            id: randomUUID(),
            campaignId: GENERATE_VIDEO_CAMPAIGN_ID,
            userId: user.id,
            email: user.email!,
            position,
            batchNumber: 0,
            status: "pending" as const,
            sentAt: null,
            idempotencyKey: `${GENERATE_VIDEO_CAMPAIGN_ID}-recipient-${user.id}`,
          };
        }),
      );
    }

    return {
      created: true,
      campaignId: GENERATE_VIDEO_CAMPAIGN_ID,
      queuedRecipients: users.length,
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