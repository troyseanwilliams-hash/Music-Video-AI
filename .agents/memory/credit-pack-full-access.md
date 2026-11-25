---
name: Credit-pack full-site access
description: Policy for what a purchased credit pack unlocks without a subscription or active trial.
---
Holding purchased credit-pack credits (a real "topup" grant AND top-up balance > 0) gives the full site, priced like the trial: credit-funded generation, unlimited clean Creator Studio exports, and Podcast Media. Lyric burns and Auto-sync still cost credits. Referral/admin credits in the top-up bucket do not count.

**Why:** the user said on 2026-11-25: "if you bought Credit pack you should have access to the full site."

**How to apply:** any new feature gate that checks subscription/trial must also accept purchased-pack holders (server `hasPurchasedTopupCredits`, client `hasPurchasedCredits` from dashboard stats). Plan-only allowances (included instrumentals, plan-tier resolution) stay plan perks.
