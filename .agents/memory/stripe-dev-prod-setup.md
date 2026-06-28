---
name: Stripe dev/prod connection setup
description: Two separate Stripe connections (dev + prod) and how to verify the managed webhook
---

# Stripe setup gotchas (AI Beat Sync)

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
