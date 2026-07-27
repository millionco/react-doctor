import { describe, expect, it } from "vite-plus/test";
import {
  parseGitBaselineDiffPlan,
  parseGithubRemoteRepository,
  parseGithubViewerPermission,
  splitNullSeparatedGitOutput,
  trimGitOutputOrNull,
} from "../src/services/git-output.js";

describe("git output parsing", () => {
  it("normalizes empty and non-empty scalar output", () => {
    expect(trimGitOutputOrNull(" \r\n ")).toBeNull();
    expect(trimGitOutputOrNull("  value\n")).toBe("value");
  });

  it.each([
    ["git@github.com:owner/repository.git", "owner/repository"],
    ["https://github.com/owner/repository.git", "owner/repository"],
    ["http://github.com/owner/repository", "owner/repository"],
    ["ssh://git@github.com/owner/repository.git", "owner/repository"],
    ["  git@github.com:owner/repository.git\n", "owner/repository"],
    ["https://gitlab.com/owner/repository.git", null],
    ["https://github.com/owner/repository/extra", null],
    ["git@github.com:owner", null],
  ])("parses GitHub remote %s", (remoteUrl, expectedRepository) => {
    expect(parseGithubRemoteRepository(remoteUrl)).toBe(expectedRepository);
  });

  it.each([
    ["ADMIN\n", "admin"],
    ["TRIAGE", "triage"],
    ["WRITE_ACCESS", "write_access"],
    ["null\n", null],
    ["", null],
    ["write", null],
    ["READ ONLY", null],
  ])("parses viewer permission %s", (stdout, expectedPermission) => {
    expect(parseGithubViewerPermission(stdout)).toBe(expectedPermission);
  });

  it("splits null-separated output without changing entry contents", () => {
    expect(splitNullSeparatedGitOutput("\0src/a.ts\0src/b\nname.ts\0\0")).toEqual([
      "src/a.ts",
      "src/b\nname.ts",
    ]);
  });

  it("maps supported status records to ordered base and head sets", () => {
    expect(
      parseGitBaselineDiffPlan(
        "A\0src/added.ts\0D\0src/deleted.ts\0M\0src/modified.ts\0T\0src/type.ts\0M\0src/modified.ts\0",
      ),
    ).toEqual({
      baseFiles: ["src/deleted.ts", "src/modified.ts", "src/type.ts"],
      headFiles: ["src/added.ts", "src/modified.ts", "src/type.ts"],
      untrackedFiles: [],
    });
  });

  it.each(["A\0", "R\0src/old.ts\0src/new.ts\0", "R100\0src/old.ts\0", "U\0src/conflict.ts\0"])(
    "rejects unsupported or incomplete baseline records",
    (output) => {
      expect(parseGitBaselineDiffPlan(output)).toBeNull();
    },
  );
});
