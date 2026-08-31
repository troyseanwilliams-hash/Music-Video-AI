import {
  db,
  emailCampaignRecipientsTable,
  emailCampaignsTable,
  nextDailyCampaignRunAt,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import {
  GENERATE_VIDEO_CAMPAIGN_ID,
  GENERATE_VIDEO_CAMPAIGN_SUBJECT,
  renderGenerateVideoCampaignHtml,
  renderGenerateVideoCampaignText,
  unsubscribeHeaders,
  unsubscribeUrl,
} from "./emailTemplates.js";

const BATCH_SIZE = 100;
const SWEEP_INTERVAL_MS = 60_000;
const INITIAL_DELAY_MS = 15_000;
const APP_URL = (process.env.APP_URL?.trim() || "https://aibeatsync.com").replace(/\/+$/, "");
const FROM = "AIBeatSync <notifications@aibeatsync.com>";

type ClaimedRecipient = {
  id: string;
  userId: string;
  email: string;
  batchNumber: number;
  idempotencyKey: string;
};

class CampaignDeliveryError extends Error {
  constructor(message: string, readonly retrySafe: boolean) {
    super(message);
  }
}

function responseBodyToText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function recoverInterruptedClaims(): Promise<void> {
  await db.execute(sql`
    UPDATE email_campaigns
    SET status = 'queued', updated_at = NOW()
    WHERE id = ${GENERATE_VIDEO_CAMPAIGN_ID}
      AND status = 'sending'
      AND updated_at < NOW() - INTERVAL '6 hours'
  `);
  await db.execute(sql`
    UPDATE email_campaign_recipients
    SET status = 'pending',
        claimed_at = NULL,
        last_error = 'Recovered after worker interruption',
        updated_at = NOW()
    WHERE campaign_id = ${GENERATE_VIDEO_CAMPAIGN_ID}
      AND status = 'sending'
      AND claimed_at < NOW() - INTERVAL '6 hours'
  `);
}

async function claimCampaign(): Promise<number | null> {
  const rows = await db.execute(sql`
    UPDATE email_campaigns
    SET status = 'sending', last_run_at = NOW(), updated_at = NOW()
    WHERE id = ${GENERATE_VIDEO_CAMPAIGN_ID}
      AND status = 'queued'
      AND next_run_at <= NOW()
    RETURNING batch_size AS "batchSize"
  `);
  const batchSize = Number((rows.rows[0] as { batchSize?: number | string } | undefined)?.batchSize ?? 0);
  return batchSize > 0 ? Math.min(batchSize, BATCH_SIZE) : null;
}

async function skipNoLongerEligibleRecipients(): Promise<void> {
  await db.execute(sql`
    UPDATE email_campaign_recipients AS r
    SET status = 'skipped',
        last_error = 'Recipient is no longer eligible',
        updated_at = NOW()
    WHERE r.campaign_id = ${GENERATE_VIDEO_CAMPAIGN_ID}
      AND r.status = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM users AS u
        WHERE u.id = r.user_id
          AND u.email IS NOT NULL
          AND u.email = r.email
          AND u.is_disabled = false
          AND u.notify_on_complete = true
      )
  `);
}

async function claimRecipients(batchSize: number): Promise<ClaimedRecipient[]> {
  const rows = await db.execute(sql`
    WITH next_batch AS (
      SELECT MIN(r.batch_number) AS batch_number
      FROM email_campaign_recipients AS r
      WHERE r.campaign_id = ${GENERATE_VIDEO_CAMPAIGN_ID}
        AND r.status = 'pending'
    ),
    candidates AS (
      SELECT r.id
      FROM email_campaign_recipients AS r
      INNER JOIN users AS u ON u.id = r.user_id
      WHERE r.campaign_id = ${GENERATE_VIDEO_CAMPAIGN_ID}
        AND r.status = 'pending'
        AND r.batch_number = (SELECT batch_number FROM next_batch)
        AND u.email IS NOT NULL
        AND u.email = r.email
        AND u.is_disabled = false
        AND u.notify_on_complete = true
      ORDER BY r.position ASC
      FOR UPDATE OF r SKIP LOCKED
      LIMIT ${batchSize}
    )
    UPDATE email_campaign_recipients AS r
    SET status = 'sending',
        attempts = r.attempts + 1,
        claimed_at = NOW(),
        updated_at = NOW()
    FROM candidates
    WHERE r.id = candidates.id
    RETURNING r.id,
              r.user_id AS "userId",
              r.email,
              r.batch_number AS "batchNumber",
              r.idempotency_key AS "idempotencyKey"
  `);
  return rows.rows as unknown as ClaimedRecipient[];
}

async function countOutstandingRecipients(): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM email_campaign_recipients
    WHERE campaign_id = ${GENERATE_VIDEO_CAMPAIGN_ID}
      AND status IN ('pending', 'sending')
  `);
  return Number((rows.rows[0] as { count?: number | string } | undefined)?.count ?? 0);
}

async function markCampaignCompletedIfEmpty(): Promise<void> {
  if ((await countOutstandingRecipients()) !== 0) return;
  await db
    .update(emailCampaignsTable)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(emailCampaignsTable.id, GENERATE_VIDEO_CAMPAIGN_ID));
  logger.info({ campaignId: GENERATE_VIDEO_CAMPAIGN_ID }, "Email campaign completed");
}

async function markRecipientPending(id: string, errorMessage: string): Promise<void> {
  await db
    .update(emailCampaignRecipientsTable)
    .set({
      status: "pending",
      claimedAt: null,
      lastError: errorMessage.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(and(
      eq(emailCampaignRecipientsTable.campaignId, GENERATE_VIDEO_CAMPAIGN_ID),
      eq(emailCampaignRecipientsTable.id, id),
      eq(emailCampaignRecipientsTable.status, "sending"),
    ));
}

async function markRecipientFailed(id: string, errorMessage: string): Promise<void> {
  await db
    .update(emailCampaignRecipientsTable)
    .set({
      status: "failed",
      claimedAt: null,
      lastError: errorMessage.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(and(
      eq(emailCampaignRecipientsTable.campaignId, GENERATE_VIDEO_CAMPAIGN_ID),
      eq(emailCampaignRecipientsTable.id, id),
      eq(emailCampaignRecipientsTable.status, "sending"),
    ));
}

async function markRecipientSent(
  id: string,
  providerMessageId: string,
  providerResponse: string,
): Promise<void> {
  await db
    .update(emailCampaignRecipientsTable)
    .set({
      status: "sent",
      claimedAt: null,
      sentAt: new Date(),
      providerMessageId,
      providerResponse: providerResponse.slice(0, 2000),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(emailCampaignRecipientsTable.campaignId, GENERATE_VIDEO_CAMPAIGN_ID),
      eq(emailCampaignRecipientsTable.id, id),
      eq(emailCampaignRecipientsTable.status, "sending"),
    ));
}

async function sendRecipient(recipient: ClaimedRecipient): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!apiKey || !sessionSecret) {
    throw new Error("Email campaign requires RESEND_API_KEY and SESSION_SECRET");
  }

  const unsub = unsubscribeUrl(APP_URL, recipient.userId);
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": recipient.idempotencyKey,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        from: FROM,
        to: [recipient.email],
        subject: GENERATE_VIDEO_CAMPAIGN_SUBJECT,
        html: renderGenerateVideoCampaignHtml({ appUrl: APP_URL, unsubscribeUrl: unsub }),
        text: renderGenerateVideoCampaignText({ appUrl: APP_URL, unsubscribeUrl: unsub }),
        headers: unsubscribeHeaders(unsub),
      }),
    });
  } catch (err) {
    throw new CampaignDeliveryError(
      `Delivery outcome unknown; manual review required: ${err instanceof Error ? err.message : responseBodyToText(err)}`,
      false,
    );
  }
  const responseText = await response.text();
  if (!response.ok) {
    throw new CampaignDeliveryError(
      `Resend API ${response.status}: ${responseText.slice(0, 500)}`,
      true,
    );
  }
  let providerMessageId = "";
  try {
    const parsed = JSON.parse(responseText) as { id?: unknown };
    providerMessageId = typeof parsed.id === "string" ? parsed.id : "";
  } catch {
    providerMessageId = "";
  }
  if (!providerMessageId) {
    throw new CampaignDeliveryError(
      "Delivery outcome unknown; provider accepted the request without returning a message id",
      false,
    );
  }
  await markRecipientSent(recipient.id, providerMessageId, responseText);
}

async function sendBatch(batch: ClaimedRecipient[]): Promise<void> {
  let sent = 0;
  let failed = 0;
  let lastError: string | null = null;
  for (const recipient of batch) {
    try {
      await sendRecipient(recipient);
      sent++;
    } catch (err) {
      lastError = err instanceof Error ? err.message : responseBodyToText(err);
      if (err instanceof CampaignDeliveryError && !err.retrySafe) {
        await markRecipientFailed(recipient.id, lastError);
      } else {
        await markRecipientPending(recipient.id, lastError);
      }
      failed++;
      logger.warn(
        { campaignId: GENERATE_VIDEO_CAMPAIGN_ID, batchNumber: recipient.batchNumber },
        "Campaign recipient send failed; retained for next daily run",
      );
    }
  }
  await db
    .update(emailCampaignsTable)
    .set({
      status: "queued",
      nextRunAt: nextDailyCampaignRunAt(),
      lastError: lastError?.slice(0, 500) ?? null,
      updatedAt: new Date(),
    })
    .where(eq(emailCampaignsTable.id, GENERATE_VIDEO_CAMPAIGN_ID));
  logger.info(
    { campaignId: GENERATE_VIDEO_CAMPAIGN_ID, batchNumber: batch[0]?.batchNumber, claimed: batch.length, sent, failed },
    "Email campaign daily cohort processed",
  );
}

async function runEmailCampaignSweep(): Promise<void> {
  await recoverInterruptedClaims();
  const batchSize = await claimCampaign();
  if (!batchSize) return;

  await skipNoLongerEligibleRecipients();
  const batch = await claimRecipients(batchSize);
  if (batch.length === 0) {
    await markCampaignCompletedIfEmpty();
    return;
  }

  await sendBatch(batch);
  await markCampaignCompletedIfEmpty();
}

export function startEmailCampaignSweep(): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runEmailCampaignSweep()
      .catch((err: unknown) => logger.error({ err }, "Email campaign sweep failed"))
      .finally(() => {
        running = false;
      });
  };
  const initialTimer = setTimeout(run, INITIAL_DELAY_MS);
  const intervalTimer = setInterval(run, SWEEP_INTERVAL_MS);
  initialTimer.unref?.();
  intervalTimer.unref?.();
  logger.info(
    { campaignId: GENERATE_VIDEO_CAMPAIGN_ID, batchSize: BATCH_SIZE, timeZone: "America/Indianapolis", hour: 9 },
    "Email campaign sweep scheduled",
  );
  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}