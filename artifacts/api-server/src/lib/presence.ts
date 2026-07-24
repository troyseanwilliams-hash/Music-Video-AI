// In-memory presence tracker — "who's live on the site" without a DB migration.
// Every authenticated user's navbar polls /dashboard/stats every 15s, which
// calls touchPresence(). getActiveUsers() returns anyone seen within the window.
// Note: in-memory, so it resets on server restart and is per-instance.

interface Presence {
  userId: string;
  email: string | null;
  name: string | null;
  lastSeen: number;
  firstSeen: number;
}

const seen = new Map<string, Presence>();
const PRUNE_AFTER_MS = 60 * 60 * 1000; // forget entries idle for an hour

export function touchPresence(userId: string, email: string | null, name: string | null): void {
  const now = Date.now();
  const existing = seen.get(userId);
  seen.set(userId, {
    userId,
    email,
    name,
    lastSeen: now,
    firstSeen: existing?.firstSeen ?? now,
  });
}

export function getActiveUsers(windowMs = 2 * 60 * 1000): Array<Presence & { secondsAgo: number }> {
  const now = Date.now();
  const cutoff = now - windowMs;
  const out: Array<Presence & { secondsAgo: number }> = [];
  for (const [id, p] of seen) {
    if (p.lastSeen >= cutoff) {
      out.push({ ...p, secondsAgo: Math.round((now - p.lastSeen) / 1000) });
    } else if (p.lastSeen < now - PRUNE_AFTER_MS) {
      seen.delete(id);
    }
  }
  return out.sort((a, b) => b.lastSeen - a.lastSeen);
}
