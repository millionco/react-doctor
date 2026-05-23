import { describe, expect, it } from "vite-plus/test";
import { parseReactMajor } from "@react-doctor/core";

describe("parseReactMajor", () => {
  it("extracts the major from caret/tilde/exact ranges", () => {
    expect(parseReactMajor("^19.0.0")).toBe(19);
    expect(parseReactMajor("~18.3.1")).toBe(18);
    expect(parseReactMajor("17.0.2")).toBe(17);
    expect(parseReactMajor("19")).toBe(19);
    expect(parseReactMajor("19.x")).toBe(19);
    expect(parseReactMajor("v19.0.0")).toBe(19);
  });

  it("uses the lower bound on multi-comparator ranges", () => {
    expect(parseReactMajor(">=18 <20")).toBe(18);
    expect(parseReactMajor(">=18.3.1 <19")).toBe(18);
    expect(parseReactMajor("18 || 19")).toBe(18);
    expect(parseReactMajor("^18.0.0 || ^19.0.0")).toBe(18);
    expect(parseReactMajor(">=17.0.0 <20.0.0")).toBe(17);
  });

  it("returns null for upper-bound-only ranges", () => {
    expect(parseReactMajor("<19")).toBeNull();
    expect(parseReactMajor("<=18")).toBeNull();
    expect(parseReactMajor("< 19")).toBeNull();
    expect(parseReactMajor("<20 || >=17")).toBeNull();
  });

  it("returns null for tags, unresolvable protocols, and missing/empty input", () => {
    expect(parseReactMajor(null)).toBeNull();
    expect(parseReactMajor(undefined)).toBeNull();
    expect(parseReactMajor("")).toBeNull();
    expect(parseReactMajor("   ")).toBeNull();
    expect(parseReactMajor("latest")).toBeNull();
    expect(parseReactMajor("next")).toBeNull();
    expect(parseReactMajor("workspace:*")).toBeNull();
    expect(parseReactMajor("github:facebook/react#1234567890")).toBeNull();
    expect(parseReactMajor("file:../react-19-local.tgz")).toBeNull();
    expect(parseReactMajor("npm:@scope/react19-fork@latest")).toBeNull();
    expect(parseReactMajor("*")).toBeNull();
  });

  it("ignores leading whitespace and prefixes", () => {
    expect(parseReactMajor("  ^19.0.0  ")).toBe(19);
    expect(parseReactMajor("npm:react@^19")).toBe(19);
    expect(parseReactMajor("npm:@vendor/react@~18.2.0")).toBe(18);
    expect(parseReactMajor("  v18.3.1  ")).toBe(18);
  });

  it("returns null for non-lower-bound comparators", () => {
    expect(parseReactMajor(">18")).toBeNull();
    expect(parseReactMajor(">18 <20")).toBeNull();
    expect(parseReactMajor("!=19")).toBeNull();
  });

  it("returns null for React experimental / canary builds (0.0.0-...)", () => {
    // React ships experimental and canary builds as `0.0.0-...` so
    // the dependency graph stays semver-safe. The first-integer scan
    // would land on `0` and misclassify them as older than any supported
    // React major; we reject 0 → null so callers can treat them as
    // unknown.
    expect(parseReactMajor("0.0.0-experimental-abc123")).toBeNull();
    expect(parseReactMajor("0.0.0-canary-1a2b3c4d-20251230")).toBeNull();
    expect(parseReactMajor("^0.0.0-experimental")).toBeNull();
  });

  it("still reads pre-release tags on real majors", () => {
    expect(parseReactMajor("19.0.0-rc.1")).toBe(19);
    expect(parseReactMajor("19.0.0-canary-abc123-20251230")).toBe(19);
    expect(parseReactMajor("^19.0.0-rc.1")).toBe(19);
  });
});
