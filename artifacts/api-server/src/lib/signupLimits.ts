const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInt(raw: string | undefined, fallback: number, allowZero = false): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0 || (n === 0 && !allowZero)) return fallback;
  return n;
}

/**
 * New accounts allowed per client IP inside the rolling window.
 * MAX_ACCOUNTS_PER_IP=0 turns the limit off. Default 5 (shared home/office
 * networks are common; email confirmation and the disposable-domain check
 * carry the rest of the abuse protection).
 */
export function maxAccountsPerIp(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env.MAX_ACCOUNTS_PER_IP, 5, true);
}

/** Rolling window, in days, over which accounts per IP are counted. Default 7. */
export function signupIpWindowDays(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env.SIGNUP_IP_WINDOW_DAYS, 7);
}

export function signupIpWindowStart(now: number, windowDays: number): Date {
  return new Date(now - windowDays * DAY_MS);
}
