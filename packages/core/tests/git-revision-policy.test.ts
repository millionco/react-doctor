import { describe, expect, it } from "vite-plus/test";
import { isSafeGitRevision, parseGitDiffRange } from "../src/services/git-revision-policy.js";

describe("git revision policy", () => {
  it.each(["HEAD", "main", "origin/main", "refs/heads/feature_1", "release/1.2.3", "abc-123"])(
    "accepts safe revision %s",
    (revision) => {
      expect(isSafeGitRevision(revision)).toBe(true);
    },
  );

  it.each([
    "",
    "--upload-pack=payload",
    ".main",
    "main.",
    "main..feature",
    "main@{1}",
    "feature branch",
    "refs:heads:main",
    "main~1",
    "main^",
    "origin\\main",
  ])("rejects unsafe revision %s", (revision) => {
    expect(isSafeGitRevision(revision)).toBe(false);
  });

  it("parses direct and symmetric ranges without resolving default endpoints", () => {
    expect(parseGitDiffRange("main..feature")).toEqual({
      base: "main",
      head: "feature",
      symmetric: false,
    });
    expect(parseGitDiffRange("main...feature")).toEqual({
      base: "main",
      head: "feature",
      symmetric: true,
    });
    expect(parseGitDiffRange("..feature")).toEqual({
      base: "",
      head: "feature",
      symmetric: false,
    });
    expect(parseGitDiffRange("main..")).toEqual({
      base: "main",
      head: "",
      symmetric: false,
    });
    expect(parseGitDiffRange("...")).toEqual({
      base: "",
      head: "",
      symmetric: true,
    });
  });

  it("leaves malformed trailing operators for endpoint validation", () => {
    expect(parseGitDiffRange("main..feature..extra")).toEqual({
      base: "main",
      head: "feature..extra",
      symmetric: false,
    });
    expect(isSafeGitRevision("feature..extra")).toBe(false);
  });

  it("returns null when no range operator is present", () => {
    expect(parseGitDiffRange("origin/main")).toBeNull();
  });
});
