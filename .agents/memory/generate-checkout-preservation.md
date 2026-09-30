---
name: Generate checkout preservation
description: Preserve an in-progress video setup when buying credits.
---

Credit purchases started in Generate should keep the original Generate tab mounted and open checkout separately. Tell users to keep the original tab open; do not promise recovery after a reload.

**Why:** Users need to retain uploaded audio, reviewed prompts, and approval state while purchasing credits. A checkout redirect would discard in-memory setup, and serializing only form text would not preserve the complete draft.

**How to apply:** Refresh balances without resetting creation state or auto-submitting generation. Treat checkout-return messages as hints only; the server balance remains authoritative.