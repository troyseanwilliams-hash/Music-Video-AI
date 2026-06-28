---
name: Verbatim-zip snapshot regressions
description: User-attached source zips are built from older snapshots and silently revert prior fixes; which fixes to re-check before applying.
---

# Verbatim-zip snapshot regressions

The recurring workflow is: user attaches a binary zip of updated source files to
apply verbatim WITHOUT breaking prior fixes. The zips are frequently generated
from an **older snapshot** of the repo, so any file they touch silently reverts
fixes made after that snapshot. Always `diff -u` each file vs repo, inspect the
**removed (`-`) lines**, and re-apply clobbered prior fixes after copying.

**Why:** observed twice — a "remix" zip reverted both the size-based AI pricing
and deleted the copyright attestation gate, because it predated both tasks.

**How to apply — before copying any zip file, confirm these surviving fixes:**

- **Size-based AI pricing** (`artifacts/api-server/src/lib/creditCost.ts`):
  `calculateCreditCost = BASE_CREDITS(20) + ceil(min(seconds,120))`. Older zips
  revert this to a Runway-token model (`RUNWAY_TOKENS_PER_5S/10S`, `MARKUP`,
  `USD_PER_CREDIT`). Keep size-based; only append any genuinely-new exports.
  Any UI mirror of this math (e.g. `fullJobCost` in `job-status.tsx`) must use
  the SAME size-based formula or the displayed estimate won't match the charge.

- **Copyright attestation gate** (`artifacts/api-server/src/routes/jobs.ts` and
  `studio.ts`): POST job/render must 403 `COPYRIGHT_REQUIRED` unless
  `req.body.acceptCopyright === true`, before destructuring / credit charge, and
  record `users.copyrightAcceptedAt` on first acceptance (column lives in
  `lib/db/src/schema/auth.ts`). Older zips delete this from jobs.ts.

- **ffmpeg OOM flags** (both jobProcessors): `-preset ultrafast -crf 28`.
- **Transitions feature** (studio.ts enum + both jobProcessors).
- **Editor upload ext handling** + **editor billing model** (see sibling notes).

**Schema pushes:** `drizzle push` is blocked interactively because it also wants
to drop an unrelated orphaned `remove_watermark` column (data loss, out of
scope). Apply additive schema changes via direct SQL instead, e.g.
`ALTER TYPE ... ADD VALUE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
