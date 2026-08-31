import { describe, expect, it } from "vitest";
import {
  renderGenerateVideoCampaignHtml,
  renderGenerateVideoCampaignText,
} from "./emailTemplates.js";

describe("Generate Video campaign email", () => {
  const params = {
    appUrl: "https://aibeatsync.com",
    unsubscribeUrl: "https://aibeatsync.com/api/email/unsubscribe?uid=test&token=test",
  };

  it("places the storyboard image before the message and the video link at the bottom only", () => {
    const html = renderGenerateVideoCampaignHtml(params);
    const imagePosition = html.indexOf("generate-video-storyboard.jpg");
    const headingPosition = html.indexOf("Build the story before you render.");
    const videoPosition = html.indexOf("https://www.youtube.com/shorts/7bL-ts1M6R8");

    expect(imagePosition).toBeGreaterThan(-1);
    expect(imagePosition).toBeLessThan(headingPosition);
    expect(videoPosition).toBeGreaterThan(html.indexOf("Come join AISync Suite"));
    expect(html.match(/https:\/\/www\.youtube\.com\/shorts\/7bL-ts1M6R8/g)).toHaveLength(1);
  });

  it("links all three sites and includes a join call to action", () => {
    const html = renderGenerateVideoCampaignHtml(params);
    const text = renderGenerateVideoCampaignText(params);

    for (const url of ["https://aisyncsuite.com", "https://aibeatsync.com", "https://aipodsync.com"]) {
      expect(html).toContain(url);
      expect(text).toContain(url);
    }
    expect(html).toContain("Come join AISync Suite");
    expect(text).toContain("Come join AISync Suite");
  });
});