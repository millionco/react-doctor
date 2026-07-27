import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveScanFileCoverage } from "../src/utils/resolve-scan-file-coverage.js";

const ROOT_DIRECTORY = path.resolve("/workspace/project");

describe("resolveScanFileCoverage", () => {
  it("normalizes and deduplicates linter coverage", () => {
    expect(
      resolveScanFileCoverage({
        rootDirectory: ROOT_DIRECTORY,
        lintFileCoverage: {
          candidateFiles: [
            path.join(ROOT_DIRECTORY, "src", "second.ts"),
            path.join(ROOT_DIRECTORY, "src", "first.ts"),
            path.join(ROOT_DIRECTORY, "src", "second.ts"),
          ],
          analyzedFiles: [
            path.join(ROOT_DIRECTORY, "src", "second.ts"),
            path.join(ROOT_DIRECTORY, "src", "first.ts"),
            path.join(ROOT_DIRECTORY, "src", "second.ts"),
          ],
        },
        lastReportedTotalFileCount: 10,
        lintIncludePathCount: 8,
        discoveredSourceFileCount: 6,
        includeScannedFilePaths: true,
        fallbackScannedFilePaths: [],
      }),
    ).toEqual({
      analyzedFiles: ["src/first.ts", "src/second.ts"],
      scannedFileCount: 2,
      scannedFilePaths: [
        path.join(ROOT_DIRECTORY, "src", "second.ts"),
        path.join(ROOT_DIRECTORY, "src", "first.ts"),
      ],
    });
  });

  it("preserves the existing file-count fallback order", () => {
    const baseOptions = {
      rootDirectory: ROOT_DIRECTORY,
      lintFileCoverage: null,
      includeScannedFilePaths: false,
      fallbackScannedFilePaths: [],
    };

    expect(
      resolveScanFileCoverage({
        ...baseOptions,
        lastReportedTotalFileCount: 5,
        lintIncludePathCount: 4,
        discoveredSourceFileCount: 3,
      }).scannedFileCount,
    ).toBe(5);
    expect(
      resolveScanFileCoverage({
        ...baseOptions,
        lastReportedTotalFileCount: 0,
        lintIncludePathCount: 4,
        discoveredSourceFileCount: 3,
      }).scannedFileCount,
    ).toBe(4);
    expect(
      resolveScanFileCoverage({
        ...baseOptions,
        lastReportedTotalFileCount: 0,
        lintIncludePathCount: null,
        discoveredSourceFileCount: 3,
      }).scannedFileCount,
    ).toBe(3);
  });

  it("uses fallback paths only when coverage is unavailable and paths are requested", () => {
    const fallbackScannedFilePaths = [path.join(ROOT_DIRECTORY, "src", "fallback.ts")];

    expect(
      resolveScanFileCoverage({
        rootDirectory: ROOT_DIRECTORY,
        lintFileCoverage: null,
        lastReportedTotalFileCount: 1,
        lintIncludePathCount: null,
        discoveredSourceFileCount: 1,
        includeScannedFilePaths: true,
        fallbackScannedFilePaths,
      }).scannedFilePaths,
    ).toEqual(fallbackScannedFilePaths);

    expect(
      resolveScanFileCoverage({
        rootDirectory: ROOT_DIRECTORY,
        lintFileCoverage: null,
        lastReportedTotalFileCount: 1,
        lintIncludePathCount: null,
        discoveredSourceFileCount: 1,
        includeScannedFilePaths: false,
        fallbackScannedFilePaths,
      }).scannedFilePaths,
    ).toEqual([]);
  });
});
