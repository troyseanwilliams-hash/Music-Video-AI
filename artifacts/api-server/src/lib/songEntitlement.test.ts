import { describe, expect, it } from "vitest";
import { getSongSettlement } from "./songEntitlement.js";

describe("song entitlement settlement", () => {
  it("never charges a successfully claimed free vocal song", () => {
    expect(getSongSettlement(true, true)).toBe("free-vocal");
  });

  it("keeps free instrumental usage on its existing allowance counter", () => {
    expect(getSongSettlement(true, false)).toBe("free-instrumental");
  });

  it("charges only when no free entitlement applies", () => {
    expect(getSongSettlement(false, true)).toBe("paid");
    expect(getSongSettlement(false, false)).toBe("paid");
  });
});