// Throwaway-inbox providers used to farm free signup credits. Extend at
// runtime with BLOCKED_EMAIL_DOMAINS (comma-separated) without a deploy.
const DISPOSABLE_DOMAINS = [
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz",
  "sharklasers.com", "grr.la", "guerrillamailblock.com", "10minutemail.com", "10minutemail.net",
  "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmail.net", "tempail.com", "tempr.email",
  "throwawaymail.com", "yopmail.com", "yopmail.net", "yopmail.fr", "trashmail.com", "trashmail.net",
  "getnada.com", "nada.email", "maildrop.cc", "dispostable.com", "fakeinbox.com", "mailnesia.com",
  "mintemail.com", "mohmal.com", "emailondeck.com", "burnermail.io", "spamgourmet.com",
  "mytemp.email", "moakt.com", "inboxkitten.com", "mail.tm", "discard.email", "discardmail.com",
  "33mail.com", "anonbox.net", "dropmail.me", "emailfake.com", "fakemail.net", "luxusmail.org",
  "mailcatch.com", "minuteinbox.com", "spambox.us", "tmail.ws", "tmpmail.org", "tmpmail.net",
  "harakirimail.com", "jetable.org", "mvrht.net", "owlymail.com", "getairmail.com", "mailforspam.com",
];

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

export function blockedEmailDomains(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const extra = (env.BLOCKED_EMAIL_DOMAINS ?? "").split(",").map(normalizeDomain).filter(Boolean);
  return new Set([...DISPOSABLE_DOMAINS, ...extra]);
}

/** True when the address's domain, or any parent domain of it, is blocked. */
export function isDisposableEmail(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const labels = normalizeDomain(email.slice(at + 1)).split(".").filter(Boolean);
  const blocked = blockedEmailDomains(env);
  for (let i = 0; i < labels.length - 1; i++) {
    if (blocked.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
