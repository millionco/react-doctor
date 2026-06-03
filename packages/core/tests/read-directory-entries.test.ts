import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { readDirectoryEntries } from "@react-doctor/core";

let temporaryRoot: string;

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-read-dir-entries-"));
});

afterEach(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("readDirectoryEntries", () => {
  it("lists entries of a readable directory", () => {
    fs.writeFileSync(path.join(temporaryRoot, "package.json"), "{}");
    fs.mkdirSync(path.join(temporaryRoot, "src"));

    const names = readDirectoryEntries(temporaryRoot)
      .map((entry) => entry.name)
      .toSorted();

    expect(names).toEqual(["package.json", "src"]);
  });

  // A best-effort discovery crawl must skip directories it cannot enumerate
  // rather than crash the scan (and report the environment to Sentry).
  it("returns no entries when the path does not exist (ENOENT)", () => {
    expect(readDirectoryEntries(path.join(temporaryRoot, "missing"))).toEqual([]);
  });

  it("returns no entries when a path component is a file (ENOTDIR)", () => {
    const filePath = path.join(temporaryRoot, "a-file");
    fs.writeFileSync(filePath, "not a directory");

    expect(readDirectoryEntries(path.join(filePath, "child"))).toEqual([]);
  });
});

// POSIX-only: Windows runners can't create symlinks without elevation and map
// these filesystem limits to different error codes. `EINVAL` (REACT-DOCTOR-N)
// shares the same Set-membership code path as `ELOOP`/`ENAMETOOLONG` but isn't
// portably reproducible from userland, so the family is exercised here.
describe.skipIf(process.platform === "win32")(
  "readDirectoryEntries (POSIX filesystem limits)",
  () => {
    it("returns no entries when the name is too long (ENAMETOOLONG)", () => {
      expect(readDirectoryEntries(path.join(temporaryRoot, "n".repeat(300)))).toEqual([]);
    });

    it("returns no entries when the path loops through symlinks (ELOOP)", () => {
      const firstLink = path.join(temporaryRoot, "first-link");
      const secondLink = path.join(temporaryRoot, "second-link");
      fs.symlinkSync(secondLink, firstLink);
      fs.symlinkSync(firstLink, secondLink);

      expect(readDirectoryEntries(path.join(firstLink, "child"))).toEqual([]);
    });
  },
);
