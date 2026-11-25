/**
 * Value for Express's "trust proxy" setting.
 *
 * `true` makes Express believe the LEFTMOST X-Forwarded-For entry, which any
 * client can set, so per-IP signup/login limits could be dodged by sending a
 * fake header. A hop count trusts only that many proxies from our side.
 *
 * The default trusts only loopback and private-network addresses. The platform
 * reaches the app through a local proxy plus internal hops (observed in
 * development as socket 127.0.0.1 with two private X-Forwarded-For entries), so
 * a fixed count of 1 would report an internal proxy as every visitor's address
 * and make the per-IP signup cap apply to everyone at once. Skipping private
 * hops returns the first public address, which is the one the edge appended;
 * anything a client forged sits to its left and is ignored.
 *
 * TRUST_PROXY_HOPS overrides: a number of hops, "0"/"false" to trust none, or a
 * list of proxy IPs/CIDRs. The literal "true" is mapped to the safe default.
 */
export const DEFAULT_TRUST_PROXY = "loopback, linklocal, uniquelocal";

export function parseTrustProxy(raw: string | undefined): number | boolean | string {
  const value = raw?.trim();
  if (!value) return DEFAULT_TRUST_PROXY;
  const lower = value.toLowerCase();
  if (lower === "true") return DEFAULT_TRUST_PROXY;
  if (lower === "false") return false;
  if (/^\d+$/.test(value)) {
    const n = Number.parseInt(value, 10);
    return n === 0 ? false : n;
  }
  return value;
}
