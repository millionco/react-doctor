import { listSourceFilesWithSize } from "../utils/list-source-files.js";

// Counts exactly the files `listSourceFilesWithSize` discovers, so the
// reported `sourceFileCount` and the scanned set can never diverge.
export const countSourceFiles = (rootDirectory: string): number =>
  listSourceFilesWithSize(rootDirectory).length;
