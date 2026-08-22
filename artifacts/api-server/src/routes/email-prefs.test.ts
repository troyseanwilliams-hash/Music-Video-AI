import { describe, expect, it } from "vitest";
import { renderReadyEmailHtml } from "../lib/emailTemplates.js";
import { videoEmailRedirect } from "./email-prefs.js";

describe("video email links", () => {
  it("sends an authenticated visitor directly to the finished job", () => {
    expect(videoEmailRedirect("job-123", true)).toBe("/jobs/job-123");
  });

  it("preserves the finished job path through login for a signed-out visitor", () => {
    expect(videoEmailRedirect("job-123", false)).toBe(
      "/login?from=%2Fjobs%2Fjob-123",
    );
  });

  it("includes both a button and a visible fallback link", () => {
    const jobUrl = "https://aibeatsync.com/api/email/video/job-123";
    const html = renderReadyEmailHtml({ title: "Test video", jobUrl });

    expect(html.match(new RegExp(jobUrl, "g"))).toHaveLength(2);
    expect(html).toContain("Signed out? We'll ask you to sign in, then open your video.");
  });
});