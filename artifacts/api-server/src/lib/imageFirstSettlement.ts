import { activeWelcomeRefund, db } from "@workspace/db";
import { creditsTable, imageAssetsTable, jobsTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { GENERATED_IMAGE_CREDITS_PER_VISUAL } from "./creditCost.js";

type ImageFirstBillingMeta = {
  imageFirstVersion?: number;
  reservedCredits?: number;
  reservedSubscriptionCredits?: number;
  reservedTopupCredits?: number;
  reservedWelcomeCredits?: number;
  imageCreditCost?: number;
  reusedSourceImageCount?: number;
  videoCreditCost?: number;
  refunded?: boolean;
  imageFirstChargedCredits?: number;
  imageFirstRefundedCredits?: number;
  bundledLipSyncChildId?: string;
  bundledLipSyncActivated?: boolean;
  storyboard?: { shots?: Array<{ index?: number }> };
  narrativeImages?: Record<string, unknown>;
  partialClips?: Record<string, unknown>;
  pendingRequests?: Record<string, unknown>;
  rejectedRequests?: Record<string, unknown>;
  uncertainSubmissions?: Record<string, unknown>;
  pendingImageRequests?: Record<string, unknown>;
  uncertainImageSubmissions?: Record<string, unknown>;
  submissionIntents?: Record<string, unknown>;
  imageReview?: { phase?: string };
};

export type ImageFirstSettlementAmounts = {
  chargedCredits: number;
  refundedCredits: number;
  subscriptionRefund: number;
  topupRefund: number;
  welcomeRefund: number;
  completedImages: number;
  spentVideoScenes: number;
};

type ImageFirstSettlementOptions = {
  expectedClaimedAt?: Date | string | null;
  terminalErrorMessage?: string;
};

export function imageFirstRetryReservation(meta: {
  imageFirstVersion?: number;
  refunded?: boolean;
  reservedCredits?: number;
  imageFirstRefundedCredits?: number;
}): number {
  const reserved = Math.max(0, meta.reservedCredits ?? 0);
  if (meta.imageFirstVersion !== 1 || !meta.refunded) return reserved;
  return Math.min(
    reserved,
    Math.max(0, meta.imageFirstRefundedCredits ?? reserved),
  );
}

export function imageFirstAutomaticRetryCost(meta: {
  imageFirstVersion?: number;
  reservedCredits?: number;
  refunded?: boolean;
  imageReview?: { phase?: string };
  partialClips?: Record<string, unknown>;
  pendingRequests?: Record<string, unknown>;
  rejectedRequests?: Record<string, unknown>;
  uncertainSubmissions?: Record<string, unknown>;
  submissionIntents?: Record<string, unknown>;
}): number {
  const reserved = Math.max(0, meta.reservedCredits ?? 0);
  const unsafeToContinueOriginalReservation = [
    meta.rejectedRequests,
    meta.uncertainSubmissions,
    meta.submissionIntents,
  ].some((entries) => entries && Object.keys(entries).length > 0);
  const continuingOriginalReservation =
    meta.imageFirstVersion === 1
    && meta.refunded !== true
    && meta.imageReview?.phase === "approved"
    && !unsafeToContinueOriginalReservation;
  return continuingOriginalReservation ? 0 : reserved;
}

function zeroSettlementAmounts(): ImageFirstSettlementAmounts {
  return {
    chargedCredits: 0,
    refundedCredits: 0,
    subscriptionRefund: 0,
    topupRefund: 0,
    welcomeRefund: 0,
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
  const completedGeneratedImages = meta.narrativeImages !== undefined
    ? validSceneIndexes(meta.narrativeImages, sceneCount).length
    : Math.max(
        0,
        completedImages - Math.max(0, Math.floor(meta.reusedSourceImageCount ?? 0)),
      );
  const acceptedImageRequests = new Set([
    ...validSceneIndexes(meta.pendingImageRequests, sceneCount),
    ...validSceneIndexes(meta.uncertainImageSubmissions, sceneCount),
  ]);
  const chargedGeneratedImageCount = Math.max(completedGeneratedImages, acceptedImageRequests.size);
  const imageCharge = Math.min(
    Math.max(0, meta.imageCreditCost ?? reserved),
    chargedGeneratedImageCount * GENERATED_IMAGE_CREDITS_PER_VISUAL,
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
  const cumulativeCharge = Math.min(reserved, imageCharge + videoCharge);
  const originalSubscription = Math.max(
    0,
    meta.reservedSubscriptionCredits
      ?? (meta.reservedTopupCredits === undefined && meta.reservedWelcomeCredits === undefined ? reserved : 0),
  );
  const originalTopup = Math.max(0, meta.reservedTopupCredits ?? 0);
  const originalWelcome = Math.max(0, meta.reservedWelcomeCredits ?? 0);
  const currentReservation = Math.min(reserved, originalWelcome + originalSubscription + originalTopup);
  const previouslyCharged = Math.min(
    reserved,
    Math.max(0, meta.imageFirstChargedCredits ?? 0),
  );
  const newlyCharged = Math.min(
    currentReservation,
    Math.max(0, cumulativeCharge - previouslyCharged),
  );
  const chargedCredits = Math.min(reserved, previouslyCharged + newlyCharged);
  const subscriptionRefund = Math.max(
    0,
    originalSubscription - Math.min(Math.max(0, newlyCharged - originalWelcome), originalSubscription),
  );
  const topupRefund = Math.max(
    0,
    originalTopup - Math.max(0, newlyCharged - originalWelcome - originalSubscription),
  );
  const welcomeRefund = Math.max(0, originalWelcome - Math.min(newlyCharged, originalWelcome));
  return {
    chargedCredits,
    refundedCredits: welcomeRefund + subscriptionRefund + topupRefund,
    subscriptionRefund,
    topupRefund,
    welcomeRefund,
    completedImages,
    spentVideoScenes,
  };
}

export async function settleImageFirstReservation(
  jobId: string,
  userId: string,
  options: ImageFirstSettlementOptions = {},
): Promise<{ handled: boolean; ownershipMatched: boolean } & ImageFirstSettlementAmounts> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        manifest: jobsTable.manifest,
        status: jobsTable.status,
        claimedAt: jobsTable.claimedAt,
      })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1)
      .for("update");
    const meta = (row?.manifest ?? {}) as ImageFirstBillingMeta;
    const empty = zeroSettlementAmounts();
    const ownershipRequired = Object.prototype.hasOwnProperty.call(options, "expectedClaimedAt");
    const expectedClaim = options.expectedClaimedAt
      ? new Date(options.expectedClaimedAt).getTime()
      : null;
    const currentClaim = row?.claimedAt ? new Date(row.claimedAt).getTime() : null;
    const processing =
      row?.status === "analyzing" || row?.status === "generating" || row?.status === "stitching";
    if (ownershipRequired && (!processing || expectedClaim !== currentClaim)) {
      return { handled: meta.imageFirstVersion === 1, ownershipMatched: false, ...empty };
    }
    if (meta.imageFirstVersion !== 1) {
      return { handled: false, ownershipMatched: true, ...empty };
    }
    if (meta.refunded) {
      if (options.terminalErrorMessage) {
        await tx.update(jobsTable).set({
          status: "failed",
          claimedAt: null,
          errorMessage: options.terminalErrorMessage,
          updatedAt: new Date(),
        }).where(eq(jobsTable.id, jobId));
      }
      return { handled: true, ownershipMatched: true, ...empty };
    }
    const [completed] = await tx
      .select({ count: count() })
      .from(imageAssetsTable)
      .where(eq(imageAssetsTable.jobId, jobId));
    const calculated = calculateImageFirstSettlement(meta, Number(completed?.count ?? 0));
    const welcomeRefund = await activeWelcomeRefund(tx, userId, calculated.welcomeRefund);
    const amounts = {
      ...calculated,
      welcomeRefund,
      refundedCredits: calculated.subscriptionRefund + calculated.topupRefund + welcomeRefund,
    };
    if (amounts.refundedCredits > 0) {
      await tx
        .update(creditsTable)
        .set({
          subscriptionCredits: sql`subscription_credits + ${amounts.subscriptionRefund}`,
          topupCredits: sql`topup_credits + ${amounts.topupRefund}`,
          welcomeCredits: sql`welcome_credits + ${amounts.welcomeRefund}`,
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
    if (options.terminalErrorMessage) {
      await tx.update(jobsTable).set({
        status: "failed",
        claimedAt: null,
        errorMessage: options.terminalErrorMessage,
        updatedAt: new Date(),
      }).where(eq(jobsTable.id, jobId));
    }
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
    return { handled: true, ownershipMatched: true, ...amounts };
  });
}