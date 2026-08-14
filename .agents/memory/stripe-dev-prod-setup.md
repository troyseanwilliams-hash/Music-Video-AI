---
name: Stripe dev/prod connection setup
description: Two separate Stripe connections (dev + prod) and how to verify the managed webhook
---

# Stripe setup gotchas (AIBeatSync)

There are **two** Replit Stripe connections, both can be `healthy`:
- `environment: production` — live keys
- `environment: development` — test keys (has extra `mcp`/`claim_url` settings)

**Each environment is seeded independently.** `pnpm --filter @workspace/scripts run seed-stripe`
seeds whichever connection matches the current environment. Prod being seeded does NOT
mean dev is seeded — verify with `stripe.prices.list({active:true})` filtered by `lookup_key`
(expect 9: starter/pro/studio ×monthly/yearly + topup_1000/5000/20000) and promo `FIRST15`.

**Why:** A "finish stripe setup" request turned out to be: prod had 12 prices + FIRST15,
dev had 0. The fix was just running the seed against the dev connection.

**Verifying the webhook:** stripe-replit-sync uses a *managed* webhook. It will NOT appear
in `stripe.webhookEndpoints.list()` (that returned 0 even when working). Instead confirm via
api-server startup logs (`Stripe webhook configured` + `Stripe data backfill complete`) and
incoming `POST /api/stripe/webhook` requests returning 200.

**How to apply:** When asked to finish/verify Stripe, check BOTH connections' catalogs, run
seed-stripe for any empty one, and judge webhook health from logs, not webhookEndpoints.list.

## Production live-key override (connector bypass)

`getCredentials()` in `stripeClient.ts` checks `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY`
secrets **only when `REPLIT_DEPLOYMENT === "1"`** (production). If both are set, it uses them
instead of the connector; otherwise it falls back to the connector. Development always uses the
connector (test keys) — the override never fires in dev even though secrets are global.

**Why:** The Replit Stripe connector flow run from the dev workspace only ever rewrites the
*development* connection; it cannot rebind the *production* connection to a different Stripe
account, and attempting it surfaces a "Connection Not Found" platform error. Secrets are the
reliable way to point the deployed app at a different live account.

**How to apply:** Changing live keys = update the two secrets + redeploy (existing deployment
runs old build until republished). Don't expect the connector flow to move the prod account.

## Seeding the secret-based (non-connector) account

`seed-products.ts` defaults to the connector account. To seed the account behind
`STRIPE_SECRET_KEY` instead (i.e. the live account the deployed app actually uses), run with
`SEED_USE_SECRET=1` — it builds the Stripe client straight from the secret.

**Why:** When repointing prod at a brand-new live account via secrets, the new account is
typically *empty* (0 products/prices/promo) even if the user believes it's "already
configured" — that belief usually refers to the OLD account. Checkout resolves prices by
`lookup_key` at purchase time, so an unseeded account makes every checkout fail. Always
validate the secret-account catalog (9 lookup keys + FIRST15) before declaring prod ready.

## Switching Stripe accounts orphans stored customer/subscription IDs

`users.stripeCustomerId` (and `stripeSubscriptionId`) are account-scoped. After pointing prod
at a different Stripe account, every stored `cus_*` / `sub_*` is invalid on the new account →
`stripe.billingPortal.sessions.create` and `checkout.sessions.create` throw
`StripeInvalidRequestError: No such customer` (code `resource_missing`) → 500.

**Fix pattern:** before using a stored customer ID, retrieve it; on `resource_missing` (or a
deleted customer) create a fresh customer on the current account and persist it. billing.ts
does this via `getOrRepairStripeCustomerId()`, used by both checkout and portal.

**How to apply:** Any flow that consumes a persisted Stripe object ID must tolerate
`resource_missing` after an account switch — repair (recreate) or clear the stale ID rather
than letting it 500. Old-account subscriptions/credits do NOT migrate automatically.
