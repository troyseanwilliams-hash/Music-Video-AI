---
name: Direct Kling cutover
description: Safety rules for migrating new video jobs from the gateway-backed Kling route to a direct Kling account.
---

Keep gateway-backed Kling and direct Kling as distinct persisted providers. A cutover applies only to newly created jobs; never reinterpret the provider on an existing job or accepted request.

**Why:** Paid async submissions are recoverable only when the original provider identity and poll handle remain stable. Reusing one provider name across the cutover could resubmit old work to a different account and cause duplicate charges.

**How to apply:** Gate new direct submissions separately from direct-request recovery. Disabling new submissions must still allow authenticated polling of accepted work. Authenticate only allowlisted Kling task hosts, preserve saved poll URLs, and enable the new-job mapping only through an explicit cutover flag after credentials and a smoke test are ready.