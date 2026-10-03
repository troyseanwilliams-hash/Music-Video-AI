import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), sms: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class { emails = { send: mocks.send }; },
}));
vi.mock("twilio", () => ({ default: mocks.sms }));
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
import { notifyNewUser } from "./notifications.js";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("email-only signup alerts", () => {
  it("sends admin email without initializing SMS", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-only");
    vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
    vi.stubEnv("NOTIFY_EMAIL", "notify@example.test");
    mocks.send.mockResolvedValue({});
    notifyNewUser({ id: "test-user", email: "user@example.test" });
    await Promise.resolve();
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "notify@example.test",
      subject: expect.stringContaining("New signup"),
    }));
    expect(mocks.sms).not.toHaveBeenCalled();
  });

  it("does not fall back to SMS when email is unavailable", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    notifyNewUser({ id: "test-user" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.sms).not.toHaveBeenCalled();
  });
});