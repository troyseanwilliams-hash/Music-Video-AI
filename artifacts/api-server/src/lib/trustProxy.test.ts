import express from "express";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { DEFAULT_TRUST_PROXY, parseTrustProxy } from "./trustProxy.js";

async function clientIpSeen(trust: ReturnType<typeof parseTrustProxy>, forwardedFor: string): Promise<string> {
  const app = express();
  app.set("trust proxy", trust);
  app.get("/", (req, res) => { res.send(req.ip); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { "X-Forwarded-For": forwardedFor } });
    return await res.text();
  } finally {
    server.close();
  }
}

describe("parseTrustProxy", () => {
  it("defaults to trusting only private proxy hops, never `true`", () => {
    expect(parseTrustProxy(undefined)).toBe(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy("")).toBe(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy("  ")).toBe(DEFAULT_TRUST_PROXY);
  });

  it("maps the unsafe literal 'true' to the safe default", () => {
    expect(parseTrustProxy("true")).toBe(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy("TRUE")).toBe(DEFAULT_TRUST_PROXY);
  });

  it("parses hop counts and the off switch", () => {
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("0")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
  });

  it("passes address lists through for Express to interpret", () => {
    expect(parseTrustProxy("loopback, 10.0.0.0/8")).toBe("loopback, 10.0.0.0/8");
  });
});

describe("client address behind the platform proxy chain", () => {
  it("finds the real visitor behind several internal hops", async () => {
    expect(await clientIpSeen(parseTrustProxy(undefined), "203.0.113.7, 10.172.64.246, 10.28.19.4")).toBe("203.0.113.7");
  });

  it("ignores a forged address placed before the real visitor", async () => {
    expect(await clientIpSeen(parseTrustProxy(undefined), "6.6.6.6, 203.0.113.7, 10.28.19.4")).toBe("203.0.113.7");
  });

  it("does not collapse distinct visitors onto one internal proxy address", async () => {
    const a = await clientIpSeen(parseTrustProxy(undefined), "198.51.100.1, 10.172.64.246, 10.28.19.4");
    const b = await clientIpSeen(parseTrustProxy(undefined), "198.51.100.2, 10.172.64.246, 10.28.19.4");
    expect(a).not.toBe(b);
  });
});
