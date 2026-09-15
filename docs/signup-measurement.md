# Signup measurement baseline

The application has one user-facing account-creation entry point:

- `POST /api/auth/register` in `artifacts/api-server/src/routes/auth.ts` creates
  a password account and now inserts `signup_completed` in the same database
  transaction.
- `/api/analytics/collect` accepts browser analytics, but explicitly ignores
  client-submitted `signup_completed` and `signup_failed` events. Both signup
  outcomes are server-authoritative; other browser events can still carry the
  existing bounded anonymous visitor id and first-touch dimensions.
- `ensureAdminUser` is a server-startup bootstrap path, not a signup. It may
  create an operator account and is intentionally not measured as a conversion.

The optional `x-analytics-anon-id` request header is only attribution context;
it is bounded and validated as an opaque visitor id. It does not change the
registration request body or authenticate the request. The frontend helper for
callers that want to pass it is
`getAnalyticsAttributionHeaders()` from
`artifacts/beatvision/src/lib/analytics.ts`.

## Read-only cohort query

Run the following as a read-only query against the target database after
replacing the two UTC bounds. It compares authoritative account rows,
server-emitted completion rows, and the first successful (`ready`) job for
each account created in the same cohort. It performs no writes.

```sql
WITH bounds AS (
  SELECT
    TIMESTAMPTZ '2026-01-01 00:00:00+00' AS start_at,
    TIMESTAMPTZ '2026-02-01 00:00:00+00' AS end_at
),
new_users AS (
  SELECT u.id, u.created_at
  FROM users u
  CROSS JOIN bounds b
  WHERE u.created_at >= b.start_at
    AND u.created_at < b.end_at
),
first_successful_job AS (
  SELECT j.user_id, MIN(j.created_at) AS first_success_at
  FROM jobs j
  WHERE j.status = 'ready'
    AND j.job_type <> 'preview_backfill'
  GROUP BY j.user_id
)
SELECT
  b.start_at,
  b.end_at,
  COUNT(nu.id) AS new_accounts,
  COUNT(nu.id) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM analytics_events ae
      WHERE ae.user_id = nu.id
        AND ae.event_type = 'signup_completed'
    )
  ) AS accounts_with_authoritative_signup_event,
  COUNT(nu.id) FILTER (
    WHERE fsj.first_success_at IS NOT NULL
  ) AS accounts_with_first_successful_job,
  ROUND(
    COUNT(nu.id) FILTER (WHERE fsj.first_success_at IS NOT NULL)::numeric
      / NULLIF(COUNT(nu.id), 0),
    4
  ) AS first_success_rate
FROM bounds b
LEFT JOIN new_users nu ON TRUE
LEFT JOIN first_successful_job fsj ON fsj.user_id = nu.id
GROUP BY b.start_at, b.end_at;
```

For a daily baseline rather than one total, group the same cohort by
`date_trunc('day', nu.created_at)` and retain the `EXISTS` predicate above.
Use `COUNT(DISTINCT nu.id)` if joining additional event tables. The
`signup_completed` event id is deterministic from the opaque user id, so
replays cannot inflate the authoritative event count.

## Observed baseline (2026-09-15 04:10 UTC)

The read-only production baseline observed at this timestamp was:

| UTC day | New accounts | Ready non-preview jobs | `signup_completed` events |
| --- | ---: | ---: | ---: |
| 2026-09-12 | 1 | 0 | 0 |
| 2026-09-14 | 11 | 0 | 0 |

These values are a historical snapshot, not a promise that the database will
remain unchanged. The event column is zero for these pre-instrumentation
cohorts; the account row remains the authoritative signup count.

## Truthful limitations

- The account row is the source of truth for creation. Completion events exist
  only from the deployment that added this instrumentation; historical users
  and startup-created admin users will not necessarily have one.
- The optional anonymous header is absent for API clients, privacy-restricted
  browsers, and visitors who register before the frontend has initialized its
  analytics id. Those accounts remain measurable in the account/job cohort but
  are not necessarily attributable to a first-touch source.
- A successful job is defined here as a `jobs.status = 'ready'` row excluding
  `job_type = 'preview_backfill'`. This baseline does not count soundtrack-only
  work or any future product-specific completion table, and it does not claim
  that a ready job was caused by the signup.
- The cohort is based on account creation time while the first successful job
  may happen later. A fixed window therefore measures “created during the
  window and successful by the query’s current data,” not a fixed-time
  conversion rate.
- Email, IP, password, request bodies, error text, and URLs are not signup
  event metadata. The event’s only metadata is the allowlisted source and
  category; this prevents a detailed attribution or failure report from being
  reconstructed from personal data.