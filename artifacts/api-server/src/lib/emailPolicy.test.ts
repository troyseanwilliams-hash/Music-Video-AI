import { describe, expect, it } from "vitest";
import { isDisposableEmail } from "./emailPolicy.js";

const env = {} as NodeJS.ProcessEnv;

describe("isDisposableEmail", () => {
  it("blocks well-known throwaway domains, case-insensitively", () => {
    expect(isDisposableEmail("a@mailinator.com", env)).toBe(true);
    expect(isDisposableEmail("A@MAILINATOR.COM", env)).toBe(true);
    expect(isDisposableEmail("x@yopmail.com", env)).toBe(true);
  });

  it("blocks subdomains of blocked domains", () => {
    expect(isDisposableEmail("x@inbox.mailinator.com", env)).toBe(true);
  });

  it("does not block real providers or look-alike domains", () => {
    expect(isDisposableEmail("a@gmail.com", env)).toBe(false);
    expect(isDisposableEmail("a@outlook.com", env)).toBe(false);
    expect(isDisposableEmail("a@notmailinator.com", env)).toBe(false);
    expect(isDisposableEmail("a@mailinator.com.au", env)).toBe(false);
    expect(isDisposableEmail("new@example.test", env)).toBe(false);
  });

  it("handles malformed input without throwing", () => {
    expect(isDisposableEmail("no-at-sign", env)).toBe(false);
    expect(isDisposableEmail("trailing@", env)).toBe(false);
    expect(isDisposableEmail("", env)).toBe(false);
  });

  it("honours BLOCKED_EMAIL_DOMAINS additions", () => {
    const custom = { BLOCKED_EMAIL_DOMAINS: " Spam.example , @farm.test" } as NodeJS.ProcessEnv;
    expect(isDisposableEmail("a@spam.example", custom)).toBe(true);
    expect(isDisposableEmail("a@farm.test", custom)).toBe(true);
    expect(isDisposableEmail("a@gmail.com", custom)).toBe(false);
  });
});
