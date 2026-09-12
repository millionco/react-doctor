import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { resolvePrefetchScanDirectory } from "../src/cli/utils/resolve-prefetch-scan-directory.js";

const currentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-prefetch-argv-"));
fs.mkdirSync(path.join(currentDirectory, "app"));
fs.mkdirSync(path.join(currentDirectory, "web"));
fs.writeFileSync(path.join(currentDirectory, "App.tsx"), "");

afterAll(() => {
  fs.rmSync(currentDirectory, { recursive: true, force: true });
});

describe("resolvePrefetchScanDirectory", () => {
  it("defaults to the current directory for a bare scan", () => {
    expect(resolvePrefetchScanDirectory([], currentDirectory)).toBe(currentDirectory);
    expect(resolvePrefetchScanDirectory(["--json", "--no-dead-code"], currentDirectory)).toBe(
      currentDirectory,
    );
  });

  it("uses the single positional directory wherever it appears", () => {
    const appDirectory = path.join(currentDirectory, "app");
    expect(resolvePrefetchScanDirectory(["app", "--json"], currentDirectory)).toBe(appDirectory);
    expect(resolvePrefetchScanDirectory(["--blocking", "none", "./app"], currentDirectory)).toBe(
      appDirectory,
    );
    expect(resolvePrefetchScanDirectory(["."], currentDirectory)).toBe(currentDirectory);
  });

  it("ignores flag values that are not directories", () => {
    expect(
      resolvePrefetchScanDirectory(
        ["--json-out", "report.json", "--blocking", "none"],
        currentDirectory,
      ),
    ).toBe(currentDirectory);
  });

  it("skips help, version, subcommands, and file scans", () => {
    expect(resolvePrefetchScanDirectory(["--help"], currentDirectory)).toBeNull();
    expect(resolvePrefetchScanDirectory(["-V"], currentDirectory)).toBeNull();
    expect(resolvePrefetchScanDirectory(["rules", "list"], currentDirectory)).toBeNull();
    expect(resolvePrefetchScanDirectory(["--json", "rules", "list"], currentDirectory)).toBeNull();
    expect(resolvePrefetchScanDirectory(["design"], currentDirectory)).toBeNull();
    expect(resolvePrefetchScanDirectory(["App.tsx"], currentDirectory)).toBeNull();
  });

  it("gives up when more than one directory is named", () => {
    expect(resolvePrefetchScanDirectory(["app", "web"], currentDirectory)).toBeNull();
  });
});
