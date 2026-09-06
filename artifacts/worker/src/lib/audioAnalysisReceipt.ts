import { createHash, createHmac, timingSafeEqual } from "crypto";

const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
type ReceiptPayload = { userId: string; objectPath: string; analysisDigest: string; expiresAt: number };

function receiptSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to sign audio analysis receipts");
  return secret;
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
function withoutAnalysisReceipt(analysis: unknown): Record<string, unknown> | null {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return null;
  const { analysisReceipt: _analysisReceipt, ...verifiedFields } = analysis as Record<string, unknown>;
  return verifiedFields;
}
function analysisDigest(analysis: unknown): string {
  return createHash("sha256").update(canonicalJson(withoutAnalysisReceipt(analysis))).digest("base64url");
}
export function signAudioAnalysisReceipt(input: { userId: string; objectPath: string; analysis: unknown; now?: number }): string {
  const payload: ReceiptPayload = {
    userId: input.userId,
    objectPath: input.objectPath,
    analysisDigest: analysisDigest(input.analysis),
    expiresAt: (input.now ?? Date.now()) + RECEIPT_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", receiptSecret()).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}