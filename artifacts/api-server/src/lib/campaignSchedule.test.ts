import { describe, expect, it } from "vitest";
import { nextDailyCampaignRunAt } from "@workspace/db";

describe("daily email campaign schedule", () => {
  it("uses today's 9 AM Indianapolis run when it is still upcoming", () => {
    expect(nextDailyCampaignRunAt(new Date("2026-08-30T12:00:00.000Z")).toISOString()).toBe(
      "2026-08-30T13:00:00.000Z",
    );
  });

  it("moves to the next local day after 9 AM has passed", () => {
    expect(nextDailyCampaignRunAt(new Date("2026-08-30T18:00:00.000Z")).toISOString()).toBe(
      "2026-08-31T13:00:00.000Z",
    );
  });

  it("accounts for Indianapolis standard time in winter", () => {
    expect(nextDailyCampaignRunAt(new Date("2026-12-30T18:00:00.000Z")).toISOString()).toBe(
      "2026-12-31T14:00:00.000Z",
    );
  });
});