---
name: Optional two-factor authentication
description: User choice for opt-in MFA and the encryption-key retention constraint.
---

Two-factor authentication is optional for everyone, including administrators.

**Why:** The user explicitly selected "Optional for everyone"; do not silently enforce it on admins or existing accounts.

**How to apply:** Preserve normal password sign-in until each user completes authenticator enrollment. Password recovery must not remove an enrolled second factor.

Keep the existing encryption root stable when deploying or rotating secrets; plan seed re-encryption before changing it.

**Why:** Authenticator seeds must remain decryptable across deployments. Rotating an encryption root without migrating stored seeds can lock opted-in users out.

**How to apply:** Treat encryption-root rotation as a separate, reviewed migration, not routine session cleanup.
