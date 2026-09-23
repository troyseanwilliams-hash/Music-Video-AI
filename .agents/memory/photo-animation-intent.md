---
name: Photo animation intent recovery
description: Why a missing operation lookup must not authorize a fresh paid intent.
---

An absent operation lookup does not prove a photo-animation POST was never accepted. Preserve the original idempotency key and permit only an identical request retry until its outcome is resolved.

**Why:** Image validation and immutable source retention occur before the serialized credit transaction. A lookup can return not found while the first request is still preparing its source.

**How to apply:** Keep browser recovery state scoped to user and source, bind it to the immutable request fingerprint, and never unlock a new paid intent merely because lookup returns 404. Keep the demonstration media separate from claims about a particular provider's supported resolution.