/**
 * Suite routes — cross-product linking between AIBeatSync and AIPodSync.
 *
 * PKCE-style flow (no shared global secret):
 *   1. AIBeat user calls POST /suite/link/authorize   → redirectUrl with ?code=...&state=...
 *   2. AIPodSync calls   POST /suite/link/exchange    → { aibeatUserId, finalizeToken }
 *   3. AIPodSync calls   POST /suite/link/finalize    → { linkId, deliveryToken }
 *
 * Delivery token: random per-link, returned once at finalize; only SHA-256 hash stored.
 * All codes/tokens hashed at rest. One-time values consumed transactionally.
 */
import { Router } from "express";
import { eq, and, gt, isNull, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  usersTable,
  creditsTable,
  suiteLinksTable,
  suiteLinkCodesTable,
  suiteFinalizeTokensTable,
  suiteSubscriptionsTable,
  suiteOutboxEventsTable,
} from "@workspace/db";
import { randomBytes, createHash } from "crypto";
import { randomUUID } from "crypto";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import { suitePagePath, suiteReturnBase } from "../lib/suiteReturnUrls.js";
import { logger } from "../lib/logger.js";
import type Stripe from "stripe";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Allowed AIPodSync base URL (allowlist). Never trust arbitrary URLs. */
function getAllowedAipodOrigins(): string[] {
  const envUrl = process.env["AIPODSYNC_BASE_URL"];
  const origins: string[] = [];
  if (envUrl) {
    try {
      const { origin } = new URL(envUrl);
      origins.push(origin);
    } catch {
      // ignore malformed env
    }
  }
  if (!origins.includes("https://aipodsync.com")) {
    origins.push("https://aipodsync.com");
  }
  return origins;
}

function isAllowedReturnUrl(url: string): boolean {
  const allowed = getAllowedAipodOrigins();
  try {
    const parsed = new URL(url);
    return allowed.some((o) => parsed.origin === o || parsed.href.startsWith(o + "/"));
  } catch {
    return false;
  }
}

// ─── Suite link catalog (lookup_key → credit allotments) ──────────────────────

const SUITE_LOOKUP_KEYS = new Set([
  "suite_creator_monthly",
  "suite_creator_yearly",
  "suite_pro_monthly",
  "suite_pro_yearly",
  "suite_studio_monthly",
  "suite_studio_yearly",
]);

function isSuiteLookupKey(key: string | null | undefined): boolean {
  return typeof key === "string" && SUITE_LOOKUP_KEYS.has(key);
}

// Token-based auth middleware for AIPodSync service calls.
// Reads `Authorization: Bearer <deliveryToken>` and resolves to the suite link.
async function requireDeliveryToken(
  req: Parameters<Router>[0],
  res: Parameters<Router>[1],
  next: Parameters<Router>[2],
): Promise<void> {
  const auth = req.headers["authorization"];
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Bearer token" });
    return;
  }
  const rawToken = auth.slice(7);
  const tokenHash = sha256(rawToken);
  const [link] = await db
    .select()
    .from(suiteLinksTable)
    .where(eq(suiteLinksTable.deliveryTokenHash, tokenHash))
    .limit(1);
  if (!link) {
    res.status(401).json({ error: "Invalid or expired delivery token" });
    return;
  }
  (req as unknown as Record<string, unknown>)["suiteLink"] = link;
  next();
}

// ─── GET /suite/status ────────────────────────────────────────────────────────

router.get("/suite/status", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [user] = await db
    .select({
      stripeSubscriptionId: usersTable.stripeSubscriptionId,
      subscriptionStatus: usersTable.subscriptionStatus,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  const links = await db
    .select()
    .from(suiteLinksTable)
    .where(eq(suiteLinksTable.aibeatUserId, req.user.id))
    .orderBy(suiteLinksTable.createdAt)
    .limit(20);

  const link = links.find((candidate) => Boolean(candidate.aipodUserId));
  const hasDirectSubscription =
    user?.subscriptionStatus === "active" &&
    Boolean(user.stripeSubscriptionId) &&
    user.stripeSubscriptionId !== link?.stripeSubscriptionId;

  if (!link) {
    res.json({ linked: false, hasDirectSubscription });
    return;
  }

  const [sub] = link
    ? await db
        .select()
        .from(suiteSubscriptionsTable)
        .where(eq(suiteSubscriptionsTable.linkId, link.id))
        .limit(1)
    : [null];

  const lookupParts = sub?.priceLookupKey?.match(
    /^suite_(creator|pro|studio)_(monthly|yearly)$/,
  );
  const plan = lookupParts?.[1] ?? null;
  const interval =
    lookupParts?.[2] === "yearly"
      ? "year"
      : lookupParts?.[2] === "monthly"
        ? "month"
        : null;

  res.json({
    linked: Boolean(link.aipodUserId),
    linkId: link.id,
    link: {
      aipodUserId: link.aipodUserId,
      aipodWalletId: link.aipodWalletId,
    },
    subscription: sub
      ? {
          status: sub.status,
          plan,
          interval,
          origin: link.checkoutOrigin,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        }
      : null,
    hasDirectSubscription,
    aipodHasDirectSubscription:
      link.aipodDirectStatus === "active" || link.aipodDirectStatus === "trialing",
    subscriptionStatus: sub?.status ?? "none",
    priceLookupKey: sub?.priceLookupKey ?? null,
    aibeatCredits: sub?.aibeatCredits ?? 0,
    aipodCredits: sub?.aipodCredits ?? 0,
  });
});

// ─── POST /suite/link/authorize ───────────────────────────────────────────────
// Authenticated. Called by the AIBeat frontend when the user clicks "Link AIPodSync".

const AuthorizeSchema = z.object({
  state: z.string().min(1).max(256),
  codeChallenge: z.string().min(43).max(128), // base64url SHA-256(verifier) from AIPodSync
  returnUrl: z.string().url(),
});

router.post("/suite/link/authorize", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = AuthorizeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { state, codeChallenge, returnUrl } = parsed.data;

  if (!isAllowedReturnUrl(returnUrl)) {
    res.status(400).json({
      error: "returnUrl is not from an allowlisted AIPodSync origin",
      allowed: getAllowedAipodOrigins(),
    });
    return;
  }

  // Create (or reuse an unfinalised) link row for this AIBeat user
  let linkId: string;
  const [existing] = await db
    .select({ id: suiteLinksTable.id })
    .from(suiteLinksTable)
    .where(
      and(
        eq(suiteLinksTable.aibeatUserId, req.user.id),
        isNull(suiteLinksTable.aipodUserId),
      ),
    )
    .limit(1);

  if (existing) {
    linkId = existing.id;
  } else {
    linkId = randomUUID();
    await db.insert(suiteLinksTable).values({
      id: linkId,
      aibeatUserId: req.user.id,
    });
  }

  // Create one-time code
  const rawCode = randomToken(32);
  const codeHash = sha256(rawCode);
  const codeChallengeHash = sha256(codeChallenge); // store hash of challenge
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  await db.insert(suiteLinkCodesTable).values({
    id: randomUUID(),
    linkId,
    codeHash,
    codeChallengeHash,
    state,
    returnUrl,
    expiresAt,
  });

  // Build redirect URL
  const redirectUrl = new URL(returnUrl);
  redirectUrl.searchParams.set("code", rawCode);
  redirectUrl.searchParams.set("state", state);

  req.log.info({ linkId, userId: req.user.id }, "Suite link authorize issued");
  res.json({ redirectUrl: redirectUrl.toString() });
});

// ─── POST /suite/link/exchange ────────────────────────────────────────────────
// Public (no session). Called by AIPodSync backend.

const ExchangeSchema = z.object({
  code: z.string().min(1),
  verifier: z.string().min(1), // raw verifier; SHA256(verifier) must == codeChallengeHash
});

router.post("/suite/link/exchange", async (req, res): Promise<void> => {
  const parsed = ExchangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { code, verifier } = parsed.data;
  const codeHash = sha256(code);
  const derivedChallenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const verifierHash = sha256(derivedChallenge);

  const [codeRow] = await db
    .select()
    .from(suiteLinkCodesTable)
    .where(
      and(
        eq(suiteLinkCodesTable.codeHash, codeHash),
        isNull(suiteLinkCodesTable.usedAt),
        gt(suiteLinkCodesTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!codeRow) {
    res.status(400).json({ error: "Invalid, expired, or already-used code" });
    return;
  }

  // PKCE verification: SHA256(verifier) must equal the stored codeChallengeHash
  if (verifierHash !== codeRow.codeChallengeHash) {
    req.log.warn({ linkId: codeRow.linkId }, "Suite PKCE verifier mismatch");
    res.status(400).json({ error: "Code verifier does not match challenge" });
    return;
  }

  // Claim the code and issue its finalize token in one transaction. The
  // compare-and-set predicate ensures two parallel exchanges cannot both win.
  const rawFinalizeToken = randomToken(32);
  const tokenHash = sha256(rawFinalizeToken);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  const link = await db.transaction(async (tx) => {
    const [claimedCode] = await tx
      .update(suiteLinkCodesTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(suiteLinkCodesTable.id, codeRow.id),
          isNull(suiteLinkCodesTable.usedAt),
          gt(suiteLinkCodesTable.expiresAt, new Date()),
        ),
      )
      .returning({ linkId: suiteLinkCodesTable.linkId });
    if (!claimedCode) return null;

    const [claimedLink] = await tx
      .select()
      .from(suiteLinksTable)
      .where(eq(suiteLinksTable.id, claimedCode.linkId))
      .limit(1);
    if (!claimedLink) {
      throw new Error("Suite link disappeared during code exchange");
    }

    await tx.insert(suiteFinalizeTokensTable).values({
      id: randomUUID(),
      linkId: claimedLink.id,
      tokenHash,
      expiresAt,
    });
    return claimedLink;
  });

  if (!link) {
    res.status(400).json({ error: "Invalid, expired, or already-used code" });
    return;
  }

  req.log.info({ linkId: link.id }, "Suite link exchanged, finalize token issued");

  res.json({
    aibeatUserId: link.aibeatUserId,
    finalizeToken: rawFinalizeToken,
  });
});

// ─── POST /suite/link/finalize ────────────────────────────────────────────────
// Public (no session). Called by AIPodSync backend after the user approves.

const FinalizeSchema = z.object({
  finalizeToken: z.string().min(1),
  aipodUserId: z.string().min(1),
  aipodWalletId: z.string().min(1),
  aipodDirectStatus: z.string().optional(),
});

router.post("/suite/link/finalize", async (req, res): Promise<void> => {
  const parsed = FinalizeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { finalizeToken, aipodUserId, aipodWalletId, aipodDirectStatus } = parsed.data;
  const tokenHash = sha256(finalizeToken);

  const [tokenRow] = await db
    .select()
    .from(suiteFinalizeTokensTable)
    .where(
      and(
        eq(suiteFinalizeTokensTable.tokenHash, tokenHash),
        isNull(suiteFinalizeTokensTable.usedAt),
        gt(suiteFinalizeTokensTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!tokenRow) {
    res.status(400).json({ error: "Invalid, expired, or already-used finalize token" });
    return;
  }

  // Generate the per-link delivery token — returned once, never stored raw
  const rawDeliveryToken = randomToken(32);
  const deliveryTokenHash = sha256(rawDeliveryToken);

  // Claim the token and finalize the link in one transaction. Both updates are
  // compare-and-set operations so parallel requests cannot rotate the delivery
  // token or attach different AIPod accounts.
  const finalizedLinkId = await db.transaction(async (tx) => {
    const [claimedToken] = await tx
      .update(suiteFinalizeTokensTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(suiteFinalizeTokensTable.id, tokenRow.id),
          isNull(suiteFinalizeTokensTable.usedAt),
          gt(suiteFinalizeTokensTable.expiresAt, new Date()),
        ),
      )
      .returning({ linkId: suiteFinalizeTokensTable.linkId });
    if (!claimedToken) return null;

    const [finalizedLink] = await tx
      .update(suiteLinksTable)
      .set({
        aipodUserId,
        aipodWalletId,
        deliveryTokenHash,
        aipodDirectStatus: aipodDirectStatus ?? null,
      })
      .where(
        and(
          eq(suiteLinksTable.id, claimedToken.linkId),
          isNull(suiteLinksTable.aipodUserId),
        ),
      )
      .returning({ id: suiteLinksTable.id });
    if (!finalizedLink) {
      throw new Error("Suite link was already finalized");
    }
    return finalizedLink.id;
  });

  if (!finalizedLinkId) {
    res.status(400).json({ error: "Invalid, expired, or already-used finalize token" });
    return;
  }

  req.log.info(
    { linkId: finalizedLinkId, aipodUserId },
    "Suite link finalized",
  );

  res.json({
    linkId: finalizedLinkId,
    deliveryToken: rawDeliveryToken,
  });
});

// ─── POST /suite/checkout ──────────────────────────────────────────────────────
// Authenticated AIBeat user. Requires an active link.

const SuiteCheckoutSchema = z.object({
  plan: z.enum(["creator", "pro", "studio"]),
  interval: z.enum(["month", "year"]),
  origin: z.enum(["aibeatsync", "aipodsync", "aisyncsuite"]),
});

router.post("/suite/checkout", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = SuiteCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { plan, interval, origin } = parsed.data;
  const lookupKey = `suite_${plan}_${interval === "month" ? "monthly" : "yearly"}`;

  // Require an active (finalized) link
  const links = await db
    .select()
    .from(suiteLinksTable)
    .where(eq(suiteLinksTable.aibeatUserId, req.user.id))
    .orderBy(suiteLinksTable.createdAt)
    .limit(20);

  const finalizedLink = links.find((candidate) => Boolean(candidate.aipodUserId));
  if (!finalizedLink) {
    res.status(400).json({
      error: "No active AIPodSync link found. Please link your AIPodSync account first.",
      code: "NO_SUITE_LINK",
    });
    return;
  }

  // Reject if user has an active NON-Suite local subscription
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (
    finalizedLink.aipodDirectStatus === "active" ||
    finalizedLink.aipodDirectStatus === "trialing"
  ) {
    res.status(409).json({
      error:
        "You already have an active AIPodSync subscription. Manage or cancel it before starting a Suite plan.",
      code: "ACTIVE_AIPOD_SUBSCRIPTION",
    });
    return;
  }

  if (
    finalizedLink.subscriptionStatus === "active" ||
    finalizedLink.subscriptionStatus === "past_due"
  ) {
    res.status(409).json({
      error:
        "You already have a Suite subscription. Use billing management to change or cancel it.",
      code: "ACTIVE_SUITE_SUBSCRIPTION",
      manageUrl: "/suite/portal",
    });
    return;
  }

  if (user.stripeSubscriptionId) {
    try {
      const stripe = await getUncachableStripeClient();
      const existingSub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      if (
        existingSub.status !== "canceled" &&
        existingSub.status !== "incomplete_expired"
      ) {
        const item = existingSub.items.data[0];
        const existingLookupKey = item?.price?.lookup_key ?? "";
        const existingIsSuite = isSuiteLookupKey(existingLookupKey);
        res.status(409).json({
          error: existingIsSuite
            ? "You already have a Suite subscription. Use billing management to change or cancel it."
            : "You already have an active subscription. Please cancel or manage it before subscribing to a Suite plan.",
          code: existingIsSuite
            ? "ACTIVE_SUITE_SUBSCRIPTION"
            : "ACTIVE_NON_SUITE_SUBSCRIPTION",
          manageUrl: existingIsSuite ? "/suite/portal" : "/billing/portal",
        });
        return;
      }
    } catch (err) {
      req.log.warn({ err }, "Could not verify existing subscription for suite checkout");
      res.status(503).json({
        error:
          "Billing status could not be verified. Please try again before starting a Suite checkout.",
        code: "BILLING_STATUS_UNAVAILABLE",
      });
      return;
    }
  }

  let reservedUserUntil: Date | null = null;
  let reservedLinkId: string | null = null;

  try {
    const stripe = await getUncachableStripeClient();

    // Resolve lookup key
    const found = await stripe.prices.list({
      lookup_keys: [lookupKey],
      active: true,
      limit: 1,
    });
    const price = found.data[0];
    if (!price) {
      res.status(400).json({ error: `No active Suite price found for: ${lookupKey}` });
      return;
    }

    // Reserve this link before creating any Stripe customer/session. The
    // compare-and-set prevents concurrent requests from creating overlapping
    // subscriptions. Stripe receives the same 31-minute expiry.
    const checkoutPendingUntil = new Date(Date.now() + 31 * 60 * 1000);
    const [reservedUser] = await db
      .update(usersTable)
      .set({ billingCheckoutPendingUntil: checkoutPendingUntil })
      .where(
        and(
          eq(usersTable.id, user.id),
          or(
            isNull(usersTable.billingCheckoutPendingUntil),
            lt(usersTable.billingCheckoutPendingUntil, new Date()),
          ),
        ),
      )
      .returning({ id: usersTable.id });
    if (!reservedUser) {
      res.status(409).json({
        error:
          "Another subscription checkout is already in progress. Please finish or cancel it first.",
        code: "CHECKOUT_IN_PROGRESS",
      });
      return;
    }
    reservedUserUntil = checkoutPendingUntil;

    const [reservedLink] = await db
      .update(suiteLinksTable)
      .set({
        checkoutOrigin: origin,
        checkoutPendingUntil,
      })
      .where(
        and(
          eq(suiteLinksTable.id, finalizedLink.id),
          inArray(suiteLinksTable.subscriptionStatus, ["none", "cancelled"]),
          or(
            isNull(suiteLinksTable.checkoutPendingUntil),
            lt(suiteLinksTable.checkoutPendingUntil, new Date()),
          ),
          or(
            isNull(suiteLinksTable.aipodDirectStatus),
            inArray(suiteLinksTable.aipodDirectStatus, [
              "none",
              "trial",
              "cancelled",
            ]),
            and(
              eq(suiteLinksTable.aipodDirectStatus, "checkout_pending"),
              lt(suiteLinksTable.aipodDirectPendingUntil, new Date()),
            ),
          ),
        ),
      )
      .returning({ id: suiteLinksTable.id });
    if (!reservedLink) {
      await db
        .update(usersTable)
        .set({ billingCheckoutPendingUntil: null })
        .where(
          and(
            eq(usersTable.id, user.id),
            eq(usersTable.billingCheckoutPendingUntil, checkoutPendingUntil),
          ),
        );
      reservedUserUntil = null;
      res.status(409).json({
        error:
          "A Suite checkout is already in progress or a subscription is already active.",
        code: "SUITE_CHECKOUT_IN_PROGRESS",
      });
      return;
    }
    reservedLinkId = reservedLink.id;

    // Ensure customer exists after winning the reservation.
    const existingCustomerId = user.stripeCustomerId;
    let customerId = existingCustomerId ?? "";
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { userId: user.id },
      });
      await db
        .update(usersTable)
        .set({ stripeCustomerId: customer.id })
        .where(eq(usersTable.id, user.id));
      customerId = customer.id;
    }

    // Retrieve aipodCredits from price metadata
    const aipodCredits = parseInt(price.metadata?.["aipodCredits"] ?? "0", 10) || 0;
    const aibeatCredits = parseInt(price.metadata?.["credits"] ?? "0", 10) || 0;

    const aibeatBase = `${req.protocol}://${req.get("host")}`;
    const aipodBase = getAllowedAipodOrigins()[0]!;
    const returnBase = suiteReturnBase(origin, aibeatBase, aipodBase);
    const returnPath = suitePagePath(origin);

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${returnBase}${returnPath}?status=success`,
        cancel_url: `${returnBase}${returnPath}?status=cancelled`,
        expires_at: Math.floor(checkoutPendingUntil.getTime() / 1000),
        allow_promotion_codes: true,
        subscription_data: {
          metadata: {
            userId: user.id,
            linkId: finalizedLink.id,
            aipodUserId: finalizedLink.aipodUserId!,
            aipodWalletId: finalizedLink.aipodWalletId!,
            origin,
            suitePlan: plan,
            aibeatCredits: String(aibeatCredits),
            aipodCredits: String(aipodCredits),
            priceLookupKey: lookupKey,
          },
        },
      },
      {
        idempotencyKey: `suite-checkout:${finalizedLink.id}:${checkoutPendingUntil.getTime()}`,
      },
    );

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    req.log.info(
      { linkId: finalizedLink.id, plan, interval, origin },
      "Suite checkout session created",
    );

    res.json({ url: session.url });
  } catch (err) {
    if (reservedLinkId && reservedUserUntil) {
      await db
        .update(suiteLinksTable)
        .set({ checkoutPendingUntil: null })
        .where(
          and(
            eq(suiteLinksTable.id, reservedLinkId),
            eq(suiteLinksTable.checkoutPendingUntil, reservedUserUntil),
          ),
        )
        .catch(() => undefined);
    }
    if (reservedUserUntil) {
      await db
        .update(usersTable)
        .set({ billingCheckoutPendingUntil: null })
        .where(
          and(
            eq(usersTable.id, req.user.id),
            eq(usersTable.billingCheckoutPendingUntil, reservedUserUntil),
          ),
        )
        .catch(() => undefined);
    }
    req.log.error({ err }, "Failed to create Suite checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ─── POST /suite/portal ────────────────────────────────────────────────────────
// Authenticated. Create a Stripe Billing Portal session.

const SuitePortalSchema = z.object({
  origin: z.enum(["aibeatsync", "aipodsync", "aisyncsuite"]).optional(),
});

router.post("/suite/portal", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = SuitePortalSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { origin = "aibeatsync" } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!user.stripeCustomerId) {
    res.status(400).json({ error: "No Stripe customer found for this account" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const aibeatReturn = process.env["REPLIT_DOMAINS"]
      ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}/suite`
      : `${req.protocol}://${req.get("host")}/suite`;
    const returnUrl =
      origin === "aibeatsync"
        ? aibeatReturn
        : `${suiteReturnBase(
            origin,
            `${req.protocol}://${req.get("host")}`,
            getAllowedAipodOrigins()[0]!,
          )}${suitePagePath(origin)}`;

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "Failed to create Suite portal session");
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

// ─── GET /suite/events ─────────────────────────────────────────────────────────
// Token-authenticated (delivery token). AIPodSync polls for pending events.

router.get("/suite/events", requireDeliveryToken as Parameters<typeof router.get>[1], async (req, res): Promise<void> => {
  const link = (req as unknown as Record<string, unknown>)["suiteLink"] as typeof suiteLinksTable.$inferSelect;

  const linkIdParam = req.query["linkId"] as string | undefined;
  if (linkIdParam && linkIdParam !== link.id) {
    res.status(403).json({ error: "linkId does not match delivery token" });
    return;
  }

  const events = await db
    .select()
    .from(suiteOutboxEventsTable)
    .where(
      and(
        eq(suiteOutboxEventsTable.linkId, link.id),
        eq(suiteOutboxEventsTable.status, "pending"),
      ),
    )
    .orderBy(suiteOutboxEventsTable.createdAt)
    .limit(50);

  // Increment attempt counter
  for (const event of events) {
    await db
      .update(suiteOutboxEventsTable)
      .set({
        attempts: event.attempts + 1,
        lastAttemptAt: new Date(),
      })
      .where(eq(suiteOutboxEventsTable.id, event.id));
  }

  res.json({
    events: events.map((e) => ({
      id: e.id,
      eventKey: e.eventKey,
      eventType: e.eventType,
      payload: JSON.parse(e.payload) as unknown,
      attempts: e.attempts + 1,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

// ─── POST /suite/events/ack ────────────────────────────────────────────────────
// Token-authenticated. AIPodSync acknowledges delivered events.

const AckSchema = z.object({
  eventIds: z.array(z.string()).min(1),
});

router.post("/suite/events/ack", requireDeliveryToken as Parameters<typeof router.post>[1], async (req, res): Promise<void> => {
  const link = (req as unknown as Record<string, unknown>)["suiteLink"] as typeof suiteLinksTable.$inferSelect;

  const parsed = AckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { eventIds } = parsed.data;
  const now = new Date();
  let acked = 0;

  for (const eventId of eventIds) {
    // Only ack events belonging to this link
    const result = await db
      .update(suiteOutboxEventsTable)
      .set({ status: "delivered", deliveredAt: now })
      .where(
        and(
          eq(suiteOutboxEventsTable.id, eventId),
          eq(suiteOutboxEventsTable.linkId, link.id),
          eq(suiteOutboxEventsTable.status, "pending"),
        ),
      )
      .returning({ id: suiteOutboxEventsTable.id });
    acked += result.length;
  }

  req.log.info({ linkId: link.id, requested: eventIds.length, acked }, "Suite events acked");
  res.json({ acked });
});

// ─── POST /suite/source-status ─────────────────────────────────────────────────
// Token-authenticated. AIPodSync updates its direct subscription status mirror.

const SourceStatusSchema = z.object({
  aipodDirectStatus: z.enum([
    "none",
    "trial",
    "active",
    "trialing",
    "cancelled",
    "past_due",
    "checkout_pending",
  ]),
});

router.post("/suite/source-status", requireDeliveryToken as Parameters<typeof router.post>[1], async (req, res): Promise<void> => {
  const link = (req as unknown as Record<string, unknown>)["suiteLink"] as typeof suiteLinksTable.$inferSelect;

  const parsed = SourceStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const status = parsed.data.aipodDirectStatus;
  if (status === "checkout_pending") {
    const pendingUntil = new Date(Date.now() + 31 * 60 * 1000);
    const [reserved] = await db
      .update(suiteLinksTable)
      .set({
        aipodDirectStatus: status,
        aipodDirectPendingUntil: pendingUntil,
      })
      .where(
        and(
          eq(suiteLinksTable.id, link.id),
          inArray(suiteLinksTable.subscriptionStatus, ["none", "cancelled"]),
          or(
            isNull(suiteLinksTable.checkoutPendingUntil),
            lt(suiteLinksTable.checkoutPendingUntil, new Date()),
          ),
          or(
            isNull(suiteLinksTable.aipodDirectPendingUntil),
            lt(suiteLinksTable.aipodDirectPendingUntil, new Date()),
          ),
        ),
      )
      .returning({ id: suiteLinksTable.id });

    if (!reserved) {
      res.status(409).json({
        error:
          "A Suite checkout is already in progress or a Suite subscription is active.",
        code: "SUITE_BILLING_CONFLICT",
      });
      return;
    }
  } else {
    await db
      .update(suiteLinksTable)
      .set({
        aipodDirectStatus: status,
        aipodDirectPendingUntil: null,
      })
      .where(eq(suiteLinksTable.id, link.id));
  }

  req.log.info(
    { linkId: link.id, aipodDirectStatus: status },
    "Suite source status updated",
  );

  res.json({ ok: true });
});

export default router;

// ─── Exported helpers used by webhookHandlers.ts ───────────────────────────────

/**
 * Enqueue an outbox event for AIPodSync. Idempotent — if a row with the same
 * eventKey already exists the insert is silently skipped.
 */
export async function enqueueSuiteOutboxEvent(params: {
  linkId: string;
  eventKey: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await db
    .insert(suiteOutboxEventsTable)
    .values({
      id: randomUUID(),
      linkId: params.linkId,
      eventKey: params.eventKey,
      eventType: params.eventType,
      payload: JSON.stringify(params.payload),
    })
    .onConflictDoNothing({ target: suiteOutboxEventsTable.eventKey });
}

/** Parse aipodCredits from a Stripe price's metadata. */
export function parseAipodCredits(
  metadata: Stripe.Metadata | null | undefined,
): number {
  if (!metadata) return 0;
  const raw = metadata["aipodCredits"];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Check if a Stripe price lookup key is a Suite plan. */
export { isSuiteLookupKey, SUITE_LOOKUP_KEYS, sha256 as suiteSha256 };
