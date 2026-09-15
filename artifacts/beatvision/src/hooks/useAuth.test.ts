import { describe, expect, it } from "vitest";
import { ANALYTICS_ANON_ID_HEADER } from "../lib/analytics";
import {
  AuthTransportError,
  buildSignupAttributionHeaders,
  isAuthTransportError,
} from "./useAuth";

describe("registration attribution contract", () => {
  it("sends the bounded anonymous id in the server contract header", () => {
    expect(buildSignupAttributionHeaders("anon-visitor-42")).toEqual({
      [ANALYTICS_ANON_ID_HEADER]: "anon-visitor-42",
    });
  });

  it("does not send malformed or missing anonymous ids", () => {
    expect(buildSignupAttributionHeaders("")).toEqual({});
    expect(buildSignupAttributionHeaders("visitor with spaces")).toEqual({});
    expect(buildSignupAttributionHeaders("a".repeat(65))).toEqual({});
    expect(buildSignupAttributionHeaders(null)).toEqual({});
  });

  it("identifies only explicit request transport failures", () => {
    expect(isAuthTransportError(new AuthTransportError())).toBe(true);
    expect(isAuthTransportError(new Error("HTTP 409"))).toBe(false);
  });
});