---
name: Cross-product billing exclusion
description: Durable safety rules for mutually exclusive billing and cross-product credit refunds.
---

Direct-product and Suite checkout paths must reserve against the same billing authority before either creates a provider Checkout Session. Local checks alone cannot prevent a distributed race. Reservations must be compare-and-set, short-lived, and aligned with the provider Session expiry.

**Why:** Two products can both observe stale “inactive” state and create overlapping subscriptions unless one authority serializes checkout. Network failures must fail closed rather than risk duplicate charges.

**How to apply:** Reserve the remote authority first, then the local wallet/link; preserve the pending state during background status sync; clear it from authoritative lifecycle webhooks.

Refunds and cancellations must revoke only the unspent credits belonging to the current Suite grant. Keep a source-aware current-invoice bucket, reset it on renewal, and decrement it alongside normal spending.

**Why:** Subtracting a plan’s face value from an aggregate wallet can remove top-up or direct-plan credits, while refunding an older invoice should not affect the current period.

**How to apply:** Match refund invoice IDs to the current grant, never infer cancellation from a refunded charge, and use the provider subscription lifecycle as the entitlement-status authority.

Webhook delivery and replay must be treated as globally unordered across old and new subscriptions. Before any lifecycle or invoice event changes a shared entitlement, credits, subscription pointer, or delivery outbox, fence it against the currently authoritative subscription.

**Why:** A delayed cancellation can erase a newer Suite grant, while a delayed historical “active” snapshot or paid invoice can resurrect an old plan after Suite ends.

**How to apply:** Serialize invoice mutations per user, re-read authority after taking the lock, ignore mismatched active sources, and live-verify unknown “active” provider snapshots before accepting them. Tests should cover both arrival orders.