import type { InspectResult } from "../../core/core-types.js";

export const countUniqueScannedFiles = (results: ReadonlyArray<InspectResult>): number => {
  const uniqueScannedFilePaths = new Set<string>();
  let fileCountFromScansWithoutPaths = 0;
  for (const result of results) {
    const scannedFilePaths = result.scannedFilePaths;
    if (scannedFilePaths && scannedFilePaths.length > 0) {
      for (const filePath of scannedFilePaths) uniqueScannedFilePaths.add(filePath);
    } else {
      fileCountFromScansWithoutPaths += result.scannedFileCount ?? result.project.sourceFileCount;
    }
  }
  return uniqueScannedFilePaths.size + fileCountFromScansWithoutPaths;
};
