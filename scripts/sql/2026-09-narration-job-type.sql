-- AIBeatSync narration jobs share the durable jobs queue. Safe for fresh,
-- existing, and repeat deployments; follows the guarded enum pattern used by
-- 2026-08-image-packs.sql.
DO $$
BEGIN
  ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'narration';
EXCEPTION
  WHEN undefined_object THEN NULL;
END
$$;