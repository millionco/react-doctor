import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { readChangedFilesFrom } from "../src/cli/utils/read-changed-files-from.js";

describe("readChangedFilesFrom", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const tempDirectory of tempDirectories.splice(0)) {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("preserves all safe relative changed files for diff metadata", () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-changed-files-"));
    tempDirectories.push(tempDirectory);
    const changedFilesPath = path.join(tempDirectory, "changed-files.txt");
    fs.writeFileSync(
      changedFilesPath,
      [
        "apps/web/src/App.tsx",
        "README.md",
        "docs/intro.mdx",
        "apps/web/src/App.tsx",
        "../outside.tsx",
        "/absolute.tsx",
        "apps/web/../admin/src/Dashboard.tsx",
      ].join("\n"),
    );

    expect(readChangedFilesFrom(changedFilesPath)).toEqual([
      "apps/web/src/App.tsx",
      "README.md",
      "docs/intro.mdx",
    ]);
  });

  it("normalizes Windows separators before safety checks", () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-changed-files-"));
    tempDirectories.push(tempDirectory);
    const changedFilesPath = path.join(tempDirectory, "changed-files.txt");
    fs.writeFileSync(changedFilesPath, "apps\\web\\src\\App.tsx\n");

    expect(readChangedFilesFrom(changedFilesPath)).toEqual(["apps/web/src/App.tsx"]);
  });
});
