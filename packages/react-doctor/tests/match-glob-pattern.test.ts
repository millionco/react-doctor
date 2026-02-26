import { describe, expect, it } from "vitest";
import { matchGlobPattern } from "../src/utils/match-glob-pattern.js";

describe("matchGlobPattern", () => {
  it("matches exact file paths", () => {
    expect(matchGlobPattern("src/app.tsx", "src/app.tsx")).toBe(true);
    expect(matchGlobPattern("src/app.tsx", "src/other.tsx")).toBe(false);
  });

  it("matches single wildcard for filenames", () => {
    expect(matchGlobPattern("src/app.tsx", "src/*.tsx")).toBe(true);
    expect(matchGlobPattern("src/utils.ts", "src/*.tsx")).toBe(false);
    expect(matchGlobPattern("src/nested/app.tsx", "src/*.tsx")).toBe(false);
  });

  it("matches double wildcard at the end", () => {
    expect(matchGlobPattern("src/generated/foo.tsx", "src/generated/**")).toBe(true);
    expect(matchGlobPattern("src/generated/bar/baz.tsx", "src/generated/**")).toBe(true);
    expect(matchGlobPattern("src/other/foo.tsx", "src/generated/**")).toBe(false);
  });

  it("matches double wildcard with trailing slash and filename", () => {
    expect(matchGlobPattern("src/foo/test.ts", "src/**/test.ts")).toBe(true);
    expect(matchGlobPattern("src/foo/bar/test.ts", "src/**/test.ts")).toBe(true);
    expect(matchGlobPattern("src/test.ts", "src/**/test.ts")).toBe(true);
  });

  it("matches double wildcard at the start", () => {
    expect(matchGlobPattern("src/components/Button.tsx", "**/*.tsx")).toBe(true);
    expect(matchGlobPattern("Button.tsx", "**/*.tsx")).toBe(true);
    expect(matchGlobPattern("deep/nested/path/file.tsx", "**/*.tsx")).toBe(true);
    expect(matchGlobPattern("file.ts", "**/*.tsx")).toBe(false);
  });

  it("matches question mark as single character", () => {
    expect(matchGlobPattern("src/a.tsx", "src/?.tsx")).toBe(true);
    expect(matchGlobPattern("src/ab.tsx", "src/?.tsx")).toBe(false);
  });

  it("escapes regex special characters in patterns", () => {
    expect(matchGlobPattern("src/file.test.tsx", "src/*.test.tsx")).toBe(true);
    expect(matchGlobPattern("src/filetesttsx", "src/*.test.tsx")).toBe(false);
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(matchGlobPattern("src\\generated\\foo.tsx", "src/generated/**")).toBe(true);
  });
});
