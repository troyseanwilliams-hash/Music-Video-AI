import { createHash, createHmac, timingSafeEqual } from "crypto";

const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

type ReceiptPayload = {
  userId: string;
  objectPath: string;
  analysisDigest: string;
  expiresAt: number;
};

function receiptSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to sign audio analysis receipts");
  return secret;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function withoutAnalysisReceipt(analysis: unknown): Record<string, unknown> | null {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return null;
  const { analysisReceipt: _analysisReceipt, ...verifiedFields } = analysis as Record<string, unknown>;
  return verifiedFields;
}

function analysisDigest(analysis: unknown): string {
  return createHash("sha256").update(canonicalJson(withoutAnalysisReceipt(analysis))).digest("base64url");
}

export function signAudioAnalysisReceipt(input: {
  userId: string;
  objectPath: string;
  analysis: unknown;
  now?: number;
}): string {
  const payload: ReceiptPayload = {
    userId: input.userId,
    objectPath: input.objectPath,
    analysisDigest: analysisDigest(input.analysis),
    expiresAt: (input.now ?? Date.now()) + RECEIPT_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", receiptSecret())
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyAudioAnalysisReceipt(input: {
  userId: string;
  objectPath: string;
  analysis: unknown;
  receipt: unknown;
  now?: number;
}): Record<string, unknown> | null {
  if (typeof input.receipt !== "string") return null;
  const [encodedPayload, encodedSignature, extra] = input.receipt.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;

  const expectedSignature = createHmac("sha256", receiptSecret())
    .update(encodedPayload)
    .digest();
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  let payload: ReceiptPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as ReceiptPayload;
  } catch {
    return null;
  }
  if (
    payload.userId !== input.userId
    || payload.objectPath !== input.objectPath
    || !Number.isFinite(payload.expiresAt)
    || payload.expiresAt < (input.now ?? Date.now())
    || payload.analysisDigest !== analysisDigest(input.analysis)
  ) {
    return null;
  }
  return withoutAnalysisReceipt(input.analysis);
}