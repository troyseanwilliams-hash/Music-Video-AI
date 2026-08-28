import { db } from "@workspace/db";
import { creditsTable, imageAssetsTable, jobsTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "./creditCost.js";

type ImageFirstBillingMeta = {
  imageFirstVersion?: number;
  reservedCredits?: number;
  reservedSubscriptionCredits?: number;
  reservedTopupCredits?: number;
  imageCreditCost?: number;
  videoCreditCost?: number;
  refunded?: boolean;
  bundledLipSyncChildId?: string;
  bundledLipSyncActivated?: boolean;
  storyboard?: { shots?: Array<{ index?: number }> };
  partialClips?: Record<string, unknown>;
  pendingRequests?: Record<string, unknown>;
  rejectedRequests?: Record<string, unknown>;
  uncertainSubmissions?: Record<string, unknown>;
};

export type ImageFirstSettlementAmounts = {
  chargedCredits: number;
  refundedCredits: number;
  subscriptionRefund: number;
  topupRefund: number;
  completedImages: number;
  spentVideoScenes: number;
};

function zeroSettlementAmounts(): ImageFirstSettlementAmounts {
  return {
    chargedCredits: 0,
    refundedCredits: 0,
    subscriptionRefund: 0,
    topupRefund: 0,
    completedImages: 0,
    spentVideoScenes: 0,
  };
}

function validSceneIndexes(value: unknown, sceneCount: number): number[] {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value as Record<string, unknown>)
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < sceneCount);
}

export function calculateImageFirstSettlement(
  meta: ImageFirstBillingMeta,
  completedImageCount: number,
): ImageFirstSettlementAmounts {
  const reserved = Math.max(0, meta.reservedCredits ?? 0);
  const sceneCount = Math.max(0, meta.storyboard?.shots?.length ?? 0);
  const completedImages = Math.min(sceneCount, Math.max(0, Math.floor(completedImageCount)));
  const imageCharge = Math.min(
    Math.max(0, meta.imageCreditCost ?? reserved),
    completedImages * GENERATED_IMAGE_CREDITS_PER_VISUAL,
  );
  const spentIndexes = new Set([
    ...validSceneIndexes(meta.partialClips, sceneCount),
    ...validSceneIndexes(meta.pendingRequests, sceneCount),
    ...validSceneIndexes(meta.rejectedRequests, sceneCount),
    ...validSceneIndexes(meta.uncertainSubmissions, sceneCount),
  ]);
  const spentVideoScenes = spentIndexes.size;
  const videoCreditCost = Math.max(0, meta.videoCreditCost ?? 0);
  const videoCharge = sceneCount > 0
    ? Math.min(videoCreditCost, Math.ceil((videoCreditCost * spentVideoScenes) / sceneCount))
    : 0;
  const chargedCredits = Math.min(reserved, imageCharge + videoCharge);
  const originalSubscription = Math.max(
    0,
    meta.reservedSubscriptionCredits
      ?? (meta.reservedTopupCredits === undefined ? reserved : 0),
  );
  const originalTopup = Math.max(0, meta.reservedTopupCredits ?? 0);
  const subscriptionRefund = Math.max(
    0,
    originalSubscription - Math.min(chargedCredits, originalSubscription),
  );
  const topupRefund = Math.max(
    0,
    originalTopup - Math.max(0, chargedCredits - originalSubscription),
  );
  return {
    chargedCredits,
    refundedCredits: subscriptionRefund + topupRefund,
    subscriptionRefund,
    topupRefund,
    completedImages,
    spentVideoScenes,
  };
}

export async function settleImageFirstReservation(
  jobId: string,
  userId: string,
): Promise<{ handled: boolean } & ImageFirstSettlementAmounts> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ manifest: jobsTable.manifest })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1)
      .for("update");
    const meta = (row?.manifest ?? {}) as ImageFirstBillingMeta;
    const empty = zeroSettlementAmounts();
    if (meta.imageFirstVersion !== 1) return { handled: false, ...empty };
    if (meta.refunded) return { handled: true, ...empty };
    const [completed] = await tx
      .select({ count: count() })
      .from(imageAssetsTable)
      .where(eq(imageAssetsTable.jobId, jobId));
    const amounts = calculateImageFirstSettlement(meta, Number(completed?.count ?? 0));
    if (amounts.refundedCredits > 0) {
      await tx
        .update(creditsTable)
        .set({
          subscriptionCredits: sql`subscription_credits + ${amounts.subscriptionRefund}`,
          topupCredits: sql`topup_credits + ${amounts.topupRefund}`,
          creditsRemaining: sql`credits_remaining + ${amounts.refundedCredits}`,
          creditsUsed: sql`GREATEST(credits_used - ${amounts.refundedCredits}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(creditsTable.userId, userId));
    }
    await tx.execute(sql`
      UPDATE jobs
      SET manifest = jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(manifest, '{}'::jsonb),
            '{refunded}',
            'true'::jsonb
          ),
          '{imageFirstChargedCredits}',
          to_jsonb(${amounts.chargedCredits}::int)
        ),
        '{imageFirstRefundedCredits}',
        to_jsonb(${amounts.refundedCredits}::int)
      ),
      updated_at = NOW()
      WHERE id = ${jobId}
    `);
    if (meta.bundledLipSyncChildId && !meta.bundledLipSyncActivated) {
      await tx
        .update(jobsTable)
        .set({
          status: "failed",
          errorMessage: "The source video could not be created, so bundled AI Lip Sync was not started.",
          updatedAt: new Date(),
        })
        .where(eq(jobsTable.id, meta.bundledLipSyncChildId));
    }
    return { handled: true, ...amounts };
  });
}