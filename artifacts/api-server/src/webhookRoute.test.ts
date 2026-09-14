import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";

const mocks = vi.hoisted(() => ({
  processWebhook: vi.fn(),
  processSuiteWebhook: vi.fn(),
}));

vi.mock("./lib/webhookHandlers.js", () => ({
  WebhookHandlers: {
    processWebhook: mocks.processWebhook,
    processSuiteWebhook: mocks.processSuiteWebhook,
  },
  isInvalidStripeSignatureError: (error: unknown) =>
    error instanceof Error &&
    error.name === "StripeSignatureVerificationError",
}));

import app from "./app.js";

let server: http.Server;
let port: number;

function postWebhook(
  signature: string,
  body = Buffer.from('{"id":"evt_test","type":"invoice.paid"}'),
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/stripe/webhook",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": body.length,
          "stripe-signature": signature,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

describe("Stripe webhook route error classification", () => {
  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = app.listen(0, "127.0.0.1", () => {
          port = (server.address() as { port: number }).port;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  it("returns 5xx for a custom billing failure so Stripe retries", async () => {
    mocks.processWebhook.mockRejectedValueOnce(
      new Error("credit database unavailable"),
    );

    const response = await postWebhook("signed");

    expect(response.statusCode).toBe(500);
  });

  it("returns 400 for an invalid Stripe signature", async () => {
    const signatureError = new Error("signature mismatch");
    signatureError.name = "StripeSignatureVerificationError";
    mocks.processWebhook.mockRejectedValueOnce(signatureError);

    const response = await postWebhook("invalid");

    expect(response.statusCode).toBe(400);
  });
});