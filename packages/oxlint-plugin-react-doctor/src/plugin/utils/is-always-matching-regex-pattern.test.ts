import { describe, expect, it } from "vite-plus/test";
import { isAlwaysMatchingRegexPattern } from "./is-always-matching-regex-pattern.js";

describe("isAlwaysMatchingRegexPattern", () => {
  it("accepts unanchored and single-anchored star patterns", () => {
    for (const pattern of ["\\s*", "^\\s*", "\\s*$", ".*", "^.*", ".*$", "[a-z]*"]) {
      expect(isAlwaysMatchingRegexPattern(pattern)).toBe(true);
    }
  });

  it("rejects dual-anchored star patterns", () => {
    for (const pattern of ["^\\s*$", "^.*$", "^[a-z]*$"]) {
      expect(isAlwaysMatchingRegexPattern(pattern)).toBe(false);
    }
  });

  it("rejects end-anchored star patterns when the regex is sticky", () => {
    expect(isAlwaysMatchingRegexPattern("\\s*$", "y")).toBe(false);
    expect(isAlwaysMatchingRegexPattern("[^\\n]*$", "gy")).toBe(false);
    expect(isAlwaysMatchingRegexPattern("^\\s*", "y")).toBe(true);
  });

  it("accepts dual and sticky patterns whose atom reaches an end boundary", () => {
    expect(isAlwaysMatchingRegexPattern("^.*$", "s")).toBe(true);
    expect(isAlwaysMatchingRegexPattern("^.*$", "m")).toBe(true);
    expect(isAlwaysMatchingRegexPattern("^[^]*$", "")).toBe(true);
    expect(isAlwaysMatchingRegexPattern("^[\\s\\S]*$", "")).toBe(true);
    expect(isAlwaysMatchingRegexPattern("[^]*$", "y")).toBe(true);
    expect(isAlwaysMatchingRegexPattern(".*$", "ys")).toBe(true);
    expect(isAlwaysMatchingRegexPattern("^[^\\n]*$", "m")).toBe(true);
    expect(isAlwaysMatchingRegexPattern("^[^\\r\\n]*$", "m")).toBe(true);
    expect(isAlwaysMatchingRegexPattern("[^\\n]*$", "ym")).toBe(true);
    expect(isAlwaysMatchingRegexPattern("^[^\\n]*$", "")).toBe(false);
  });
});
