import { describe, expect, it } from "vite-plus/test";
import { parseTailwindMajorMinor } from "@react-doctor/core";

describe("parseTailwindMajorMinor", () => {
  it("extracts major.minor from caret/tilde/exact ranges", () => {
    expect(parseTailwindMajorMinor("^3.4.1")).toEqual({ major: 3, minor: 4 });
    expect(parseTailwindMajorMinor("~3.3.0")).toEqual({ major: 3, minor: 3 });
    expect(parseTailwindMajorMinor("3.4.0")).toEqual({ major: 3, minor: 4 });
    expect(parseTailwindMajorMinor("3.4")).toEqual({ major: 3, minor: 4 });
    expect(parseTailwindMajorMinor("v4.0.0")).toEqual({ major: 4, minor: 0 });
  });

  it("treats major-only specs as minor 0", () => {
    expect(parseTailwindMajorMinor("4")).toEqual({ major: 4, minor: 0 });
    expect(parseTailwindMajorMinor("^4")).toEqual({ major: 4, minor: 0 });
    expect(parseTailwindMajorMinor("4.x")).toEqual({ major: 4, minor: 0 });
  });

  it("uses the lower bound on multi-comparator ranges", () => {
    expect(parseTailwindMajorMinor(">=3.4 <5")).toEqual({ major: 3, minor: 4 });
    expect(parseTailwindMajorMinor("3.4 || 4.0")).toEqual({ major: 3, minor: 4 });
  });

  it("returns null for tags, workspace protocols, and missing/empty input", () => {
    expect(parseTailwindMajorMinor(null)).toBeNull();
    expect(parseTailwindMajorMinor(undefined)).toBeNull();
    expect(parseTailwindMajorMinor("")).toBeNull();
    expect(parseTailwindMajorMinor("   ")).toBeNull();
    expect(parseTailwindMajorMinor("latest")).toBeNull();
    expect(parseTailwindMajorMinor("next")).toBeNull();
    expect(parseTailwindMajorMinor("workspace:*")).toBeNull();
    expect(parseTailwindMajorMinor("*")).toBeNull();
  });

  it("ignores leading whitespace and prefixes", () => {
    expect(parseTailwindMajorMinor("  ^3.4.1  ")).toEqual({ major: 3, minor: 4 });
    expect(parseTailwindMajorMinor("npm:tailwindcss@^3.4.1")).toEqual({ major: 3, minor: 4 });
  });

  it("returns null for experimental / 0.x.x builds", () => {
    expect(parseTailwindMajorMinor("0.0.0-insiders.abc123")).toBeNull();
    expect(parseTailwindMajorMinor("^0.0.0-insiders")).toBeNull();
  });

  it("still reads pre-release tags on real majors", () => {
    expect(parseTailwindMajorMinor("4.0.0-beta.1")).toEqual({ major: 4, minor: 0 });
    expect(parseTailwindMajorMinor("^3.4.0-rc.1")).toEqual({ major: 3, minor: 4 });
  });
});
