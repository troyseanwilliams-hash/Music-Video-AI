import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getGuideDismissed, setGuideDismissed, shouldAutoOpen } from "../utils";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
  };
})();

Object.defineProperty(global, "window", {
  value: { localStorage: localStorageMock },
  writable: true,
});

Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("Creation Guide Utils", () => {
  beforeEach(() => {
    // Reset localStorage before each test
    localStorage.clear();
  });

  describe("Storage Helpers", () => {
    it("should return false by default", () => {
      expect(getGuideDismissed("user1")).toBe(false);
    });

    it("should save and retrieve dismissal state scoped by user", () => {
      setGuideDismissed("user1");
      expect(getGuideDismissed("user1")).toBe(true);
      expect(getGuideDismissed("user2")).toBe(false); // Scoped correctly
    });
  });

  describe("shouldAutoOpen", () => {
    it("should return false if not authenticated", () => {
      expect(shouldAutoOpen("/dashboard", false)).toBe(false);
      expect(shouldAutoOpen("/dashboard", false, "user1")).toBe(false);
    });

    it("should return false if no userId", () => {
      expect(shouldAutoOpen("/dashboard", true)).toBe(false);
    });

    it("should return true for normal routes if not dismissed", () => {
      expect(shouldAutoOpen("/dashboard", true, "user1")).toBe(true);
      expect(shouldAutoOpen("/gallery", true, "user1")).toBe(true);
      expect(shouldAutoOpen("/", true, "user1")).toBe(true);
    });

    it("should return false if dismissed", () => {
      setGuideDismissed("user1");
      expect(shouldAutoOpen("/dashboard", true, "user1")).toBe(false);
    });

    it("should return false for sensitive routes", () => {
      const sensitiveRoutes = [
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/pricing",
        "/redeem",
        "/editor",
        "/jobs/123",
      ];
      
      sensitiveRoutes.forEach(route => {
        expect(shouldAutoOpen(route, true, "user1")).toBe(false);
      });
    });
  });
});
