import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { readBaselineLineMap } from "../src/cli/utils/read-baseline-line-map.js";
import { commitAll, initGitRepo, writeFile } from "./regressions/_helpers.js";

describe("readBaselineLineMap", () => {
  let directory: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-baseline-lines-"));
    initGitRepo(directory);
    writeFile(path.join(directory, "file.tsx"), "first\nsecond\nthird\nfourth\nfifth\n");
    commitAll(directory, "base");
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("maps insertions and deletions before old findings", () => {
    writeFile(path.join(directory, "file.tsx"), "added\nfirst\nsecond\nthird\nfifth\n");
    const mapLine = readBaselineLineMap(directory, "HEAD");
    expect(mapLine("file.tsx", 1)).toBe(2);
    expect(mapLine("file.tsx", 3)).toBe(4);
    expect(mapLine("file.tsx", 5)).toBe(5);
  });

  it("uses the new path for renamed files", () => {
    execFileSync("git", ["mv", "file.tsx", "renamed.tsx"], { cwd: directory });
    writeFile(path.join(directory, "renamed.tsx"), "added\nfirst\nsecond\nthird\nfourth\nfifth\n");
    expect(readBaselineLineMap(directory, "HEAD")("renamed.tsx", 3)).toBe(4);
  });

  it("keeps line positions when the saved revision is unavailable", () => {
    expect(readBaselineLineMap(directory, "missing")("file.tsx", 3)).toBe(3);
    expect(readBaselineLineMap(directory, undefined)("file.tsx", 3)).toBe(3);
    expect(readBaselineLineMap(directory, "--output=unexpected")("file.tsx", 3)).toBe(3);
  });
});
