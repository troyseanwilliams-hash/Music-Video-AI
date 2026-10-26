import { describe, expect, it } from "vitest";
import {
  MEDIA_RETENTION_MS,
  mediaObjectPaths,
  membershipExpirationOf,
} from "./mediaRetention.js";

describe("media retention policy", () => {
  it("collects only storage paths from media fields, not prompts or arbitrary text", () => {
    const paths = mediaObjectPaths({
      prompt: "Keep this literal /objects/someone-elses-file.mp4",
      audioObjectPath: "/objects/uploads/user-1/song.mp3",
      clips: [{ objectPath: "/objects/jobs/job-1/clip.mp4" }],
      clipPaths: ["/objects/podcast/clip.mp4"],
      metadata: { note: "/objects/ignore-this.png" },
    });

    expect([...paths].sort()).toEqual([
      "/objects/jobs/job-1/clip.mp4",
      "/objects/podcast/clip.mp4",
      "/objects/uploads/user-1/song.mp3",
    ]);
  });

  it("starts from the later of a trial end and paid membership end", () => {
    const trialEndsAt = new Date("2026-10-01T00:00:00Z");
    const membershipExpiresAt = new Date("2026-11-01T00:00:00Z");

    expect(membershipExpirationOf({
      subscriptionStatus: "trial",
      trialEndsAt,
      membershipExpiresAt,
    })).toEqual(membershipExpiresAt);
  });

  it.each(["active", "past_due"])("does not expire a %s member", (subscriptionStatus) => {
    expect(membershipExpirationOf({
      subscriptionStatus,
      trialEndsAt: new Date("2020-01-01T00:00:00Z"),
      membershipExpiresAt: new Date("2020-02-01T00:00:00Z"),
    })).toBeNull();
  });

  it("does not infer a paid membership's end from an old trial date", () => {
    expect(membershipExpirationOf({
      subscriptionStatus: "cancelled",
      stripeSubscriptionId: "sub_123",
      trialEndsAt: new Date("2020-01-01T00:00:00Z"),
      membershipExpiresAt: null,
    })).toBeNull();
  });

  it("applies exactly 30 days from the retention start", () => {
    const startedAt = new Date("2026-10-01T12:30:00Z");
    expect(startedAt.getTime() + MEDIA_RETENTION_MS)
      .toBe(new Date("2026-10-31T12:30:00Z").getTime());
  });
});
