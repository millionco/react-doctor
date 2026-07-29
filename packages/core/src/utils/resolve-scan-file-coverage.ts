import * as path from "node:path";
import { toNormalizedRelativePath } from "./to-normalized-relative-path.js";

interface ScanFileCoverage {
  readonly candidateFiles: ReadonlyArray<string>;
  readonly analyzedFiles: ReadonlyArray<string>;
}

interface ResolveScanFileCoverageOptions {
  readonly rootDirectory: string;
  readonly lintFileCoverage: ScanFileCoverage | null;
  readonly lastReportedTotalFileCount: number;
  readonly lintIncludePathCount: number | null;
  readonly discoveredSourceFileCount: number;
  readonly includeScannedFilePaths: boolean;
  readonly fallbackScannedFilePaths: ReadonlyArray<string>;
}

interface ResolvedScanFileCoverage {
  readonly analyzedFiles: ReadonlyArray<string>;
  readonly scannedFileCount: number;
  readonly scannedFilePaths: ReadonlyArray<string>;
}

const normalizeFilePaths = (filePaths: ReadonlyArray<string>, rootDirectory: string): string[] => [
  ...new Set(filePaths.map((filePath) => toNormalizedRelativePath(filePath, rootDirectory))),
];

export const resolveScanFileCoverage = ({
  rootDirectory,
  lintFileCoverage,
  lastReportedTotalFileCount,
  lintIncludePathCount,
  discoveredSourceFileCount,
  includeScannedFilePaths,
  fallbackScannedFilePaths,
}: ResolveScanFileCoverageOptions): ResolvedScanFileCoverage => {
  const candidateFiles =
    lintFileCoverage === null
      ? []
      : normalizeFilePaths(lintFileCoverage.candidateFiles, rootDirectory);
  const analyzedFiles =
    lintFileCoverage === null
      ? []
      : normalizeFilePaths(lintFileCoverage.analyzedFiles, rootDirectory).sort();
  const scannedFileCount =
    candidateFiles.length ||
    lastReportedTotalFileCount ||
    lintIncludePathCount ||
    discoveredSourceFileCount;
  const scannedFilePaths = includeScannedFilePaths
    ? candidateFiles.length > 0
      ? candidateFiles.map((filePath) => path.resolve(rootDirectory, filePath))
      : fallbackScannedFilePaths
    : [];

  return {
    analyzedFiles,
    scannedFileCount,
    scannedFilePaths,
  };
};
