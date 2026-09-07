---
name: Email system conventions
description: Branded email templates, worker/api-server copy rule, and unsubscribe security constraints
---

- All transactional emails share the branded template module `emailTemplates.ts`, kept **byte-identical** in api-server and worker `src/lib/` (like renderEmail.ts). Edit in api-server, `cp` to worker.
- **Why:** worker sends render emails independently; drift breaks branding/token compat.
- Unsubscribe links are HMAC tokens keyed on SESSION_SECRET (no fallback secret — throws if missing; callers degrade to a dashboard link, never block signup).
- GET /api/email/unsubscribe must stay **non-mutating** (confirmation page); only POST flips the flag. **Why:** email security scanners follow GET links and were the review-flagged risk.
- Security emails (password reset) must never carry unsubscribe links/headers.
- Render failure alerts go only to ADMIN_EMAIL; customers receive outbound render notifications only for successful completion. Failed status remains visible in their authenticated dashboard.
