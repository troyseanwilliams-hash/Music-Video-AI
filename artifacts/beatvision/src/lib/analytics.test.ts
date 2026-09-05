import { describe, expect, it } from "vitest";
import {
  sanitizeAnalyticsData,
  sanitizeCampaignDimension,
  sanitizeReferrerDomain,
} from "./analytics";

describe("sanitizeAnalyticsData", () => {
  it("keeps only finite primitive analytics properties", () => {
    expect(sanitizeAnalyticsData({
      plan: "pro",
      credits: 100,
      authenticated: true,
      missing: null,
      nested: { prompt: "private" },
      list: ["private"],
      infinite: Number.POSITIVE_INFINITY,
    })).toEqual({
      plan: "pro",
      credits: 100,
      authenticated: true,
    });
  });

  it("omits empty metadata", () => {
    expect(sanitizeAnalyticsData()).toBeUndefined();
    expect(sanitizeAnalyticsData({ nested: {} })).toBeUndefined();
  });

  it("keeps campaign dimensions low-cardinality and identifier-safe", () => {
    expect(sanitizeCampaignDimension("release_launch-2026")).toBe("release_launch-2026");
    expect(sanitizeCampaignDimension("customer@example.com")).toBe("");
    expect(sanitizeCampaignDimension("campaign with spaces")).toBe("");
  });

  it("stores only the hostname from a referrer", () => {
    expect(sanitizeReferrerDomain("https://example.com/private/path?email=user@example.com")).toBe("example.com");
    expect(sanitizeReferrerDomain("news.example.com")).toBe("news.example.com");
    expect(sanitizeReferrerDomain("not a url")).toBe("");
  });
});