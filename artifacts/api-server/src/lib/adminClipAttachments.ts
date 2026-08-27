import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type AdminClipAttachmentMeta = {
  strictUniqueSourcesVersion?: number;
  partialClips?: Record<string, string>;
  pendingRequests?: Record<string, unknown>;
  rejectedRequests?: Record<string, unknown>;
  attachedClipSources?: Record<string, string>;
  attachedClipContentHashes?: Record<string, string>;
  storyboard?: { numClips?: number };
};

export type ClipAttachmentInput = { index: number; url: string };

function urlsIn(value: unknown): URL[] {
  const found: URL[] = [];
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === "https:") found.push(parsed);
      } catch {
        // Request ids and error messages are not URLs.
      }
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const nested of Object.values(candidate as Record<string, unknown>)) visit(nested);
  };
  visit(value);
  return found;
}

export function trustedClipOrigins(
  meta: AdminClipAttachmentMeta,
  index: number,
): Set<string> {
  const evidence = meta.strictUniqueSourcesVersion === 1
    ? [meta.pendingRequests?.[String(index)], meta.rejectedRequests?.[String(index)]]
    : [...Object.values(meta.pendingRequests ?? {}), ...Object.values(meta.rejectedRequests ?? {})];
  return new Set(evidence.flatMap(urlsIn).map((url) => url.origin));
}

export function validateClipAttachment(
  meta: AdminClipAttachmentMeta,
  input: unknown,
  acceptedUrls: Set<string> = new Set(),
): { ok: true; clip: ClipAttachmentInput; trustedOrigins: Set<string> } | { ok: false; index: number; error: string } {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const index = Number(record.index);
  const rawUrl = typeof record.url === "string" ? record.url.trim() : "";
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, index: Number.isFinite(index) ? index : -1, error: "index must be a non-negative integer" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, index, error: "url must be a valid https URL" };
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return { ok: false, index, error: "url must be a credential-free https URL" };
  }

  const url = parsed.href;
  const origins = trustedClipOrigins(meta, index);
  if (!origins.has(parsed.origin)) {
    return { ok: false, index, error: "url origin is not trusted by persisted provider request evidence" };
  }

  if (
    acceptedUrls.has(url) ||
    Object.values(meta.attachedClipSources ?? {}).includes(url) ||
    Object.values(meta.partialClips ?? {}).includes(url)
  ) {
    return { ok: false, index, error: "the same clip URL cannot be attached to multiple storyboard indexes" };
  }

  if (meta.strictUniqueSourcesVersion === 1) {
    const planned = meta.storyboard?.numClips;
    if (!Number.isInteger(planned) || planned! <= 0 || index >= planned!) {
      return { ok: false, index, error: "index is outside the immutable storyboard range" };
    }
    if (Object.prototype.hasOwnProperty.call(meta.partialClips ?? {}, String(index))) {
      return { ok: false, index, error: "strict jobs cannot overwrite an existing storyboard clip" };
    }
  }

  return { ok: true, clip: { index, url }, trustedOrigins: origins };
}

function isForbiddenAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase().split("%")[0]!;
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isForbiddenAddress(mapped[1]!) : false;
  }
  return true;
}

export type AddressLookup = (hostname: string) => Promise<Array<{ address: string }>>;

async function defaultLookup(hostname: string): Promise<Array<{ address: string }>> {
  return lookup(hostname, { all: true, verbatim: true });
}

export async function securelyDownloadTrustedClip(
  initialUrl: string,
  trustedOrigins: Set<string>,
  options: {
    fetchImpl?: typeof fetch;
    lookupAddresses?: AddressLookup;
    maxRedirects?: number;
  } = {},
): Promise<Buffer> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupAddresses = options.lookupAddresses ?? defaultLookup;
  const maxRedirects = options.maxRedirects ?? 5;
  let current = new URL(initialUrl);

  for (let redirects = 0; ; redirects++) {
    if (current.protocol !== "https:" || !trustedOrigins.has(current.origin)) {
      throw new Error("Clip URL or redirect origin is not trusted");
    }
    const hostname = current.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname) ? [{ address: hostname }] : await lookupAddresses(hostname);
    if (addresses.length === 0 || addresses.some(({ address }) => isForbiddenAddress(address))) {
      throw new Error("Clip URL resolves to a private, loopback, or link-local address");
    }

    const response = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Clip download redirect ${response.status} had no location`);
      if (redirects >= maxRedirects) throw new Error("Clip download exceeded the redirect limit");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Failed to download clip: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

export function clipContentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}