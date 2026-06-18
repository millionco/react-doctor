import * as path from "node:path";

/**
 * Resolves a diagnostic's `filePath` (relative to its project root, or
 * already absolute) to an absolute path. Shared by the code-frame reader and
 * the terminal hyperlink builder so both turn a relative path into the same
 * on-disk location.
 */
export const resolveAbsolutePath = (filePath: string, rootDirectory: string): string =>
  path.isAbsolute(filePath) ? filePath : path.resolve(rootDirectory || ".", filePath);
