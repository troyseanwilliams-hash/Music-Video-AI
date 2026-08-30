import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function positiveIntEnv(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

// Keep the conservative defaults that work for a single API/worker pair, while
// allowing operators to increase pool capacity when they add worker processes.
// The hard cap prevents an accidental env typo from exhausting PostgreSQL.
const poolMax = positiveIntEnv("DB_POOL_MAX", 10, 100);
const idleTimeoutMillis = positiveIntEnv("DB_IDLE_TIMEOUT_MS", 30_000, 300_000);
const connectionTimeoutMillis = positiveIntEnv("DB_CONNECTION_TIMEOUT_MS", 10_000, 120_000);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  idleTimeoutMillis,
  connectionTimeoutMillis,
  maxUses: positiveIntEnv("DB_POOL_MAX_USES", 0, 100_000) || undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./campaignSchedule";
