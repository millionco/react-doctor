import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { CliInputError } from "../src/cli/utils/cli-input-error.js";
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

  // An unreadable --changed-files-from file is a user invocation mistake, not a
  // bug: it must surface as a clean CliInputError (kept out of Sentry) rather
  // than throwing the raw fs error (REACT-DOCTOR-V).
  it("throws a clean CLI input error when the file does not exist", () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-changed-files-"));
    tempDirectories.push(tempDirectory);
    const missingPath = path.join(tempDirectory, "missing.txt");

    expect(() => readChangedFilesFrom(missingPath)).toThrow(CliInputError);
    expect(() => readChangedFilesFrom(missingPath)).toThrow("--changed-files-from");
  });

  it("throws a clean CLI input error when the path is a directory", () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-changed-files-"));
    tempDirectories.push(tempDirectory);

    expect(() => readChangedFilesFrom(tempDirectory)).toThrow(CliInputError);
  });
});
