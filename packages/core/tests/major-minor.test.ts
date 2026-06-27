import { describe, expect, it } from "vite-plus/test";
import { isMajorMinorAtLeast } from "@react-doctor/core";

describe("isMajorMinorAtLeast", () => {
  it("returns true when detected major is greater than required", () => {
    expect(isMajorMinorAtLeast({ major: 20, minor: 0 }, { major: 19, minor: 2 })).toBe(true);
    expect(isMajorMinorAtLeast({ major: 4, minor: 0 }, { major: 3, minor: 4 })).toBe(true);
  });

  it("returns true when major matches and detected minor >= required", () => {
    expect(isMajorMinorAtLeast({ major: 19, minor: 2 }, { major: 19, minor: 2 })).toBe(true);
    expect(isMajorMinorAtLeast({ major: 19, minor: 5 }, { major: 19, minor: 2 })).toBe(true);
    expect(isMajorMinorAtLeast({ major: 3, minor: 4 }, { major: 3, minor: 4 })).toBe(true);
  });

  it("returns false when major matches but detected minor < required", () => {
    expect(isMajorMinorAtLeast({ major: 19, minor: 0 }, { major: 19, minor: 2 })).toBe(false);
    expect(isMajorMinorAtLeast({ major: 19, minor: 1 }, { major: 19, minor: 2 })).toBe(false);
    expect(isMajorMinorAtLeast({ major: 3, minor: 3 }, { major: 3, minor: 4 })).toBe(false);
  });

  it("returns false when detected major is less than required", () => {
    expect(isMajorMinorAtLeast({ major: 18, minor: 99 }, { major: 19, minor: 2 })).toBe(false);
    expect(isMajorMinorAtLeast({ major: 2, minor: 9 }, { major: 3, minor: 4 })).toBe(false);
  });

  it("optimistically returns true when detection failed (null detected)", () => {
    // Unparseable specs (workspace protocols, dist-tags) shouldn't silently
    // drop version-gated rules. Callers gate on a separate "detected at all"
    // check (e.g. `reactMajorVersion !== null`) before relying on this.
    expect(isMajorMinorAtLeast(null, { major: 19, minor: 2 })).toBe(true);
    expect(isMajorMinorAtLeast(null, { major: 4, minor: 0 })).toBe(true);
  });
});
