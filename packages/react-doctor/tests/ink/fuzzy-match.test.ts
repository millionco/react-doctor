import { describe, expect, it } from "vite-plus/test";
import { fuzzyMatch } from "../../src/cli/ink/lib/fuzzy-match.js";

describe("fuzzyMatch", () => {
  it("matches everything with a neutral score for an empty query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, matchedIndices: [] });
  });

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyMatch("xyz", "react-doctor")).toBeNull();
  });

  it("reports the matched indices in order", () => {
    const result = fuzzyMatch("rd", "react-doctor");
    expect(result?.matchedIndices).toEqual([0, 6]);
  });

  it("ranks a contiguous match above a scattered one", () => {
    const contiguous = fuzzyMatch("abc", "abcde");
    const scattered = fuzzyMatch("abc", "axbxc");
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("WEB", "website")).not.toBeNull();
  });
});
