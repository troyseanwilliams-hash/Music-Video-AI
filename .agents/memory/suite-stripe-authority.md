---
name: Suite Stripe authority
description: Safety rules for running AISync Suite billing on a Stripe account separate from standalone products.
---

Suite Stripe customer IDs must live on the Suite account link, alongside the Stripe account ID that created them. Never reuse a standalone product customer ID across Stripe accounts. A missing dedicated Suite configuration may use the shared account only as an explicit, logged compatibility fallback.

**Why:** Stripe customer and subscription IDs are account-scoped. Reusing or retrieving them through another account causes resource-missing failures and can block future checkout after a Suite cancellation.

**How to apply:** Validate the stored account ID and retrieve the customer before reuse; recreate stale customers. Verify dedicated Suite webhook signatures with a separate webhook secret and route Suite checkout, portal, lifecycle, refund, and replay operations through the same Suite Stripe client.

When a terminal Suite subscription leaves its ID in the shared user subscription pointer, standalone checkout may clear that pointer only after proving it belongs to the same user's cancelled Suite link. Active or past-due Suite authority must continue to fail closed.