import { describe, expect, it } from "vite-plus/test";
import { isReactAtLeast, parseReactMajorMinor } from "@react-doctor/core";

describe("parseReactMajorMinor", () => {
  it("extracts major.minor from caret/tilde/exact ranges", () => {
    expect(parseReactMajorMinor("^19.2.0")).toEqual({ major: 19, minor: 2 });
    expect(parseReactMajorMinor("~19.0.3")).toEqual({ major: 19, minor: 0 });
    expect(parseReactMajorMinor("19.2.0")).toEqual({ major: 19, minor: 2 });
    expect(parseReactMajorMinor("19.2")).toEqual({ major: 19, minor: 2 });
    expect(parseReactMajorMinor("v19.0.0")).toEqual({ major: 19, minor: 0 });
  });

  it("treats major-only specs as minor 0", () => {
    expect(parseReactMajorMinor("19")).toEqual({ major: 19, minor: 0 });
    expect(parseReactMajorMinor("^19")).toEqual({ major: 19, minor: 0 });
    expect(parseReactMajorMinor("19.x")).toEqual({ major: 19, minor: 0 });
  });

  it("uses the lower bound on multi-comparator ranges", () => {
    expect(parseReactMajorMinor(">=19.2 <20")).toEqual({ major: 19, minor: 2 });
    expect(parseReactMajorMinor("19.2 || 20.0")).toEqual({ major: 19, minor: 2 });
  });

  it("regression: upper-bound comparator is stripped before matching", () => {
    // Without upper-bound stripping the regex matches `19.2` from the
    // exclusive upper bound, falsely reporting React 19.2+ even though
    // the range *excludes* 19.2.
    expect(parseReactMajorMinor("<19.2 >=19.0")).toEqual({ major: 19, minor: 0 });
    expect(parseReactMajorMinor("<=19.2.0 >=19.0.0")).toEqual({ major: 19, minor: 0 });
    expect(parseReactMajorMinor(">=18.3 <19.2")).toEqual({ major: 18, minor: 3 });
    expect(parseReactMajorMinor("<19.2-beta >=19.0")).toEqual({ major: 19, minor: 0 });
  });

  it("returns null for tags, workspace protocols, and empty input", () => {
    expect(parseReactMajorMinor(null)).toBeNull();
    expect(parseReactMajorMinor(undefined)).toBeNull();
    expect(parseReactMajorMinor("")).toBeNull();
    expect(parseReactMajorMinor("   ")).toBeNull();
  });

  it("ignores leading whitespace and npm: alias prefixes", () => {
    expect(parseReactMajorMinor("  ^19.2.0  ")).toEqual({ major: 19, minor: 2 });
    expect(parseReactMajorMinor("npm:react@^19.2.0")).toEqual({ major: 19, minor: 2 });
  });
});

describe("isReactAtLeast", () => {
  it("returns true when detected major is greater than required", () => {
    expect(isReactAtLeast({ major: 20, minor: 0 }, { major: 19, minor: 2 })).toBe(true);
  });

  it("returns true when major matches and detected minor >= required", () => {
    expect(isReactAtLeast({ major: 19, minor: 2 }, { major: 19, minor: 2 })).toBe(true);
    expect(isReactAtLeast({ major: 19, minor: 5 }, { major: 19, minor: 2 })).toBe(true);
  });

  it("returns false when major matches but detected minor < required", () => {
    expect(isReactAtLeast({ major: 19, minor: 0 }, { major: 19, minor: 2 })).toBe(false);
    expect(isReactAtLeast({ major: 19, minor: 1 }, { major: 19, minor: 2 })).toBe(false);
  });

  it("returns false when detected major is less than required", () => {
    expect(isReactAtLeast({ major: 18, minor: 99 }, { major: 19, minor: 2 })).toBe(false);
  });

  it("optimistically returns true when detection failed (null detected)", () => {
    // Matches the Tailwind precedent: unparseable specs (workspace
    // protocols, dist-tags) shouldn't silently drop version-gated
    // rules. Callers are expected to gate on a separate "detected at
    // all" check (e.g. `reactMajor !== null`) before relying on this.
    expect(isReactAtLeast(null, { major: 19, minor: 2 })).toBe(true);
  });
});
