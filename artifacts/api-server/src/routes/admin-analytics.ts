// Admin-only analytics overview. Combines the first-party event log
// (analytics_events) with authoritative product tables (users, jobs,
// soundtracks, credit_grants) to answer four questions:
//   1. Funnel drop-off  — visitor → signup → activated → paid
//   2. Time per page     — where attention actually goes
//   3. Feature usage     — what people make, trial vs paid
//   4. Traffic sources   — where visitors come from & which page they land on
//
// Everything is scoped to a rolling window (?days=, default 30).

import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

function isAdmin(email: string | null | undefined): boolean {
  return !!(
    process.env.ADMIN_EMAIL &&
    email &&
    email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()
  );
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

router.get("/admin/analytics/overview", async (req, res) => {
  if (!req.isAuthenticated() || !isAdmin(req.user.email)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Clamp the window to something sane (1–365 days).
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1), 365);

  try {
    // ── Funnel ────────────────────────────────────────────────────────────
    // Follow one attributable cohort: anonymous visitors seen in the window
    // are linked to accounts when the same browser later sends an authenticated
    // event. Activation and payment are then measured for those linked users.
    const funnelQ = db.execute(sql`
      WITH
      win AS (SELECT NOW() - make_interval(days => ${days}) AS since),
      visitors AS (
        SELECT DISTINCT anon_id
        FROM analytics_events, win
        WHERE event_type = 'pageview'
          AND anon_id IS NOT NULL
          AND created_at >= win.since
      ),
      identity_links AS (
        SELECT DISTINCT ON (ae.anon_id)
               ae.anon_id,
               ae.user_id
        FROM analytics_events ae
        JOIN visitors v ON v.anon_id = ae.anon_id
        WHERE ae.user_id IS NOT NULL
        ORDER BY ae.anon_id, ae.created_at ASC
      ),
      cohort_users AS (
        SELECT DISTINCT u.id
        FROM identity_links il
        JOIN users u ON u.id = il.user_id
        CROSS JOIN win
        WHERE u.created_at >= win.since
      )
      SELECT
        (SELECT COUNT(*) FROM visitors) AS visitors,
        (SELECT COUNT(*) FROM cohort_users) AS signups,
        (SELECT COUNT(*) FROM cohort_users cu
           WHERE EXISTS (
             SELECT 1 FROM jobs j WHERE j.user_id = cu.id AND j.status = 'ready'
           )
           OR EXISTS (
             SELECT 1 FROM soundtracks s WHERE s.user_id = cu.id
           )) AS activated,
        (SELECT COUNT(*) FROM cohort_users cu
           JOIN users u ON u.id = cu.id
           WHERE u.subscription_status = 'active'
              OR EXISTS (
                SELECT 1 FROM credit_grants g
                WHERE g.user_id = cu.id AND g.source IN ('subscription','topup')
              )) AS paid
    `);

    // ── Time per page ─────────────────────────────────────────────────────
    const timeQ = db.execute(sql`
      SELECT path,
             COUNT(*)                        AS views,
             ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_seconds,
             ROUND(SUM(duration_ms) / 60000.0, 1) AS total_minutes
      FROM analytics_events
      WHERE event_type = 'page_time'
        AND path IS NOT NULL
        AND duration_ms IS NOT NULL
        AND created_at >= NOW() - make_interval(days => ${days})
      GROUP BY path
      ORDER BY SUM(duration_ms) DESC
      LIMIT 20
    `);

    // ── Feature usage (with trial vs paid split) ──────────────────────────
    const featureQ = db.execute(sql`
      WITH win AS (SELECT NOW() - make_interval(days => ${days}) AS since)
      SELECT
        (SELECT COUNT(*) FROM jobs j, win WHERE j.job_type = 'ai' AND j.created_at >= win.since) AS ai_videos,
        (SELECT COUNT(*) FROM jobs j, win WHERE j.job_type IN ('remix','editor_render') AND j.created_at >= win.since) AS remix_renders,
        (SELECT COUNT(*) FROM soundtracks s, win WHERE s.has_vocals = false AND s.created_at >= win.since) AS instrumentals,
        (SELECT COUNT(*) FROM soundtracks s, win WHERE s.has_vocals = true AND s.created_at >= win.since) AS vocal_songs,
        (SELECT COUNT(*) FROM jobs j JOIN users u ON u.id = j.user_id, win
           WHERE j.created_at >= win.since AND u.subscription_status = 'active') AS generations_paid,
        (SELECT COUNT(*) FROM jobs j JOIN users u ON u.id = j.user_id, win
           WHERE j.created_at >= win.since AND u.subscription_status <> 'active') AS generations_trial
    `);

    // ── Traffic: first-touch source + landing page per visitor ────────────
    const firstTouch = sql`
      SELECT DISTINCT ON (anon_id)
             anon_id,
             path AS landing_path,
             COALESCE(
               NULLIF(utm_source, ''),
               NULLIF(regexp_replace(COALESCE(referrer, ''), '^https?://(www\\.)?([^/]+).*$', '\\2'), ''),
               'direct'
             ) AS source
      FROM analytics_events
      WHERE event_type = 'pageview' AND anon_id IS NOT NULL
        AND created_at >= NOW() - make_interval(days => ${days})
      ORDER BY anon_id, created_at ASC
    `;
    const sourcesQ = db.execute(sql`
      WITH ft AS (${firstTouch})
      SELECT source, COUNT(*) AS visitors FROM ft GROUP BY source ORDER BY visitors DESC LIMIT 15
    `);
    const landingQ = db.execute(sql`
      WITH ft AS (${firstTouch})
      SELECT landing_path, COUNT(*) AS visitors FROM ft
      WHERE landing_path IS NOT NULL GROUP BY landing_path ORDER BY visitors DESC LIMIT 15
    `);

    // ── Daily trend: visitors & signups ───────────────────────────────────
    const visitorTrendQ = db.execute(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             COUNT(DISTINCT anon_id) AS visitors
      FROM analytics_events
      WHERE event_type = 'pageview'
        AND created_at >= NOW() - make_interval(days => ${days})
      GROUP BY 1 ORDER BY 1
    `);
    const signupTrendQ = db.execute(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             COUNT(*) AS signups
      FROM users
      WHERE created_at >= NOW() - make_interval(days => ${days})
      GROUP BY 1 ORDER BY 1
    `);

    // ── Key growth-loop actions (named events from the client tracker) ────
    const actionsQ = db.execute(sql`
      SELECT event_type, COUNT(*) AS n
      FROM analytics_events
      WHERE created_at >= NOW() - make_interval(days => ${days})
        AND event_type IN ('share_clip','referral_share','referral_copy','checkout_start','checkout_intent_logged_out')
      GROUP BY event_type
    `);

    // All accounts, not only browser-attributed signups. Video creation time is
    // the completion authority; mutable job.updated_at is not a completion date.
    const activationQ = db.execute(sql`
      WITH cohort AS (
        SELECT id, created_at FROM users
        WHERE created_at >= NOW() - make_interval(days => ${days})
      ), outcomes AS (
        SELECT c.*,
          EXISTS (
            SELECT 1 FROM videos v JOIN jobs j ON j.id = v.job_id
            WHERE v.user_id = c.id AND j.job_type = 'ai'
              AND v.created_at >= c.created_at
              AND v.created_at < c.created_at + interval '7 days'
          ) AS completed
        FROM cohort c
      )
      SELECT COUNT(*) AS signups,
        COUNT(*) FILTER (WHERE completed) AS completed,
        COUNT(*) FILTER (WHERE created_at <= NOW() - interval '7 days') AS mature_signups,
        COUNT(*) FILTER (WHERE completed AND created_at <= NOW() - interval '7 days') AS mature_completed
      FROM outcomes
    `);
    const starterStepsQ = db.execute(sql`
      SELECT ae.meta->>'step' AS step, COUNT(DISTINCT ae.user_id) AS users
      FROM analytics_events ae JOIN users u ON u.id = ae.user_id
      WHERE ae.event_type = 'starter_video_step'
        AND u.created_at >= NOW() - make_interval(days => ${days})
        AND ae.created_at >= u.created_at
        AND ae.created_at < u.created_at + interval '7 days'
        AND ae.meta->>'step' IN ('opened','audio_ready','visual_ready','review','storyboard_opened','submitted','customize')
      GROUP BY ae.meta->>'step'
    `);
    // First-use checkpoints across all three starting paths. Browser choices
    // are observational; account, submission and saved-result counts are DB-backed.
    const firstCreationQ = db.execute(sql`
      WITH cohort AS (
        SELECT id, created_at, email_verification_required, email_verified_at
        FROM users WHERE created_at >= NOW() - make_interval(days => ${days})
      ), checkpoints AS (
        SELECT c.*,
          EXISTS (SELECT 1 FROM analytics_events a WHERE a.user_id = c.id
            AND a.event_type = 'goal_selected' AND a.meta->>'goal' = 'montage'
            AND a.created_at >= c.created_at AND a.created_at < c.created_at + interval '7 days') AS chose_studio,
          EXISTS (SELECT 1 FROM analytics_events a WHERE a.user_id = c.id
            AND a.event_type = 'goal_selected' AND a.meta->>'goal' = 'generate'
            AND a.created_at >= c.created_at AND a.created_at < c.created_at + interval '7 days') AS chose_video,
          EXISTS (SELECT 1 FROM analytics_events a WHERE a.user_id = c.id
            AND a.event_type = 'goal_selected' AND a.meta->>'goal' = 'images'
            AND a.created_at >= c.created_at AND a.created_at < c.created_at + interval '7 days') AS chose_images,
          (EXISTS (SELECT 1 FROM jobs j WHERE j.user_id = c.id
            AND j.created_at >= c.created_at AND j.created_at < c.created_at + interval '7 days')
            OR EXISTS (SELECT 1 FROM soundtracks s WHERE s.user_id = c.id
            AND s.created_at >= c.created_at AND s.created_at < c.created_at + interval '7 days')) AS submitted,
          (EXISTS (SELECT 1 FROM videos v WHERE v.user_id = c.id AND v.deleted_at IS NULL
            AND v.created_at >= c.created_at AND v.created_at < c.created_at + interval '7 days')
            OR EXISTS (SELECT 1 FROM image_assets i WHERE i.user_id = c.id AND i.deleted_at IS NULL
            AND i.created_at >= c.created_at AND i.created_at < c.created_at + interval '7 days')
            OR EXISTS (SELECT 1 FROM soundtracks s WHERE s.user_id = c.id
            AND s.created_at >= c.created_at AND s.created_at < c.created_at + interval '7 days')) AS saved_result
        FROM cohort c
      )
      SELECT COUNT(*) AS signups,
        COUNT(*) FILTER (WHERE email_verification_required) AS confirmation_required,
        COUNT(*) FILTER (WHERE email_verification_required AND email_verified_at >= created_at
          AND email_verified_at < created_at + interval '7 days') AS confirmed,
        COUNT(*) FILTER (WHERE chose_studio OR chose_video OR chose_images) AS chose_path,
        COUNT(*) FILTER (WHERE chose_studio) AS chose_studio,
        COUNT(*) FILTER (WHERE chose_video) AS chose_video,
        COUNT(*) FILTER (WHERE chose_images) AS chose_images,
        COUNT(*) FILTER (WHERE submitted) AS submitted,
        COUNT(*) FILTER (WHERE saved_result) AS saved_result
      FROM checkpoints
    `);
    const [funnel, time, feature, sources, landing, vTrend, sTrend, actions, activation, starterSteps, firstCreation] = await Promise.all([
      funnelQ, timeQ, featureQ, sourcesQ, landingQ, visitorTrendQ, signupTrendQ, actionsQ,
      activationQ, starterStepsQ, firstCreationQ,
    ]);

    const actionMap = new Map<string, number>();
    for (const r of actions.rows as Record<string, unknown>[]) {
      actionMap.set(String(r.event_type), num(r.n));
    }

    const f = (funnel.rows[0] ?? {}) as Record<string, unknown>;
    const feat = (feature.rows[0] ?? {}) as Record<string, unknown>;

    // Merge the two daily series into one array keyed by day.
    const trendMap = new Map<string, { day: string; visitors: number; signups: number }>();
    for (const r of vTrend.rows as Record<string, unknown>[]) {
      const day = String(r.day);
      trendMap.set(day, { day, visitors: num(r.visitors), signups: 0 });
    }
    for (const r of sTrend.rows as Record<string, unknown>[]) {
      const day = String(r.day);
      const row = trendMap.get(day) ?? { day, visitors: 0, signups: 0 };
      row.signups = num(r.signups);
      trendMap.set(day, row);
    }
    const trend = [...trendMap.values()].sort((a, b) => a.day.localeCompare(b.day));

    res.json({
      days,
      firstCreation: {
        signups: num(firstCreation.rows[0]?.signups),
        confirmationRequired: num(firstCreation.rows[0]?.confirmation_required),
        confirmed: num(firstCreation.rows[0]?.confirmed),
        chosePath: num(firstCreation.rows[0]?.chose_path),
        choseStudio: num(firstCreation.rows[0]?.chose_studio),
        choseVideo: num(firstCreation.rows[0]?.chose_video),
        choseImages: num(firstCreation.rows[0]?.chose_images),
        submitted: num(firstCreation.rows[0]?.submitted),
        savedResult: num(firstCreation.rows[0]?.saved_result),
      },
      firstVideoActivation: {
        signups: num(activation.rows[0]?.signups),
        completed: num(activation.rows[0]?.completed),
        matureSignups: num(activation.rows[0]?.mature_signups),
        matureCompleted: num(activation.rows[0]?.mature_completed),
        steps: starterSteps.rows.map((row) => ({ step: String(row.step), users: num(row.users) })),
      },
      funnel: {
        visitors: num(f.visitors),
        signups: num(f.signups),
        activated: num(f.activated),
        paid: num(f.paid),
      },
      timePerPage: (time.rows as Record<string, unknown>[]).map((r) => ({
        path: String(r.path),
        views: num(r.views),
        avgSeconds: num(r.avg_seconds),
        totalMinutes: num(r.total_minutes),
      })),
      featureUsage: {
        aiVideos: num(feat.ai_videos),
        remixRenders: num(feat.remix_renders),
        instrumentals: num(feat.instrumentals),
        vocalSongs: num(feat.vocal_songs),
        generationsPaid: num(feat.generations_paid),
        generationsTrial: num(feat.generations_trial),
      },
      keyActions: {
        shareClip: actionMap.get("share_clip") ?? 0,
        referralShare: actionMap.get("referral_share") ?? 0,
        referralCopy: actionMap.get("referral_copy") ?? 0,
        checkoutStart: actionMap.get("checkout_start") ?? 0,
        checkoutIntentLoggedOut: actionMap.get("checkout_intent_logged_out") ?? 0,
      },
      sources: (sources.rows as Record<string, unknown>[]).map((r) => ({
        source: String(r.source),
        visitors: num(r.visitors),
      })),
      landingPages: (landing.rows as Record<string, unknown>[]).map((r) => ({
        path: String(r.landing_path),
        visitors: num(r.visitors),
      })),
      trend,
    });
  } catch (err) {
    req.log?.error({ err }, "analytics overview failed");
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

export default router;
