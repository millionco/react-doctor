import { describe, expect, it } from "vite-plus/test";
import { parseReactMajorMinor } from "@react-doctor/core";

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

  it("returns null for tags, unresolved sources, and empty input", () => {
    expect(parseReactMajorMinor(null)).toBeNull();
    expect(parseReactMajorMinor(undefined)).toBeNull();
    expect(parseReactMajorMinor("")).toBeNull();
    expect(parseReactMajorMinor("   ")).toBeNull();
    expect(parseReactMajorMinor("catalog:react19")).toBeNull();
    expect(parseReactMajorMinor("workspace:~19.2.0")).toBeNull();
    expect(parseReactMajorMinor("git+https://github.com/acme/react.git#v19.2.0")).toBeNull();
    expect(parseReactMajorMinor("acme/react#v19.2.0")).toBeNull();
  });

  it("ignores leading whitespace and npm: alias prefixes", () => {
    expect(parseReactMajorMinor("  ^19.2.0  ")).toEqual({ major: 19, minor: 2 });
    expect(parseReactMajorMinor("npm:react@^19.2.0")).toEqual({ major: 19, minor: 2 });
    expect(parseReactMajorMinor("npm:react-v18@^19.2.0")).toEqual({ major: 19, minor: 2 });
  });
});
