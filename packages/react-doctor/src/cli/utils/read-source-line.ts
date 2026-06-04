import { createNodeReadFileLinesSync } from "@react-doctor/core";

/**
 * Builds a cached `(filePath, line) -> source text` reader rooted at
 * `rootDirectory`, used to fingerprint a diagnostic by the content of its
 * flagged line (see `computeDiagnosticDelta`). Wraps core's
 * `createNodeReadFileLinesSync` with per-file memoization + 1-indexed line
 * lookup; unreadable files / out-of-range lines return `null`.
 */
export const createSourceLineReader = (
  rootDirectory: string,
): ((filePath: string, line: number) => string | null) => {
  const readFileLines = createNodeReadFileLinesSync(rootDirectory);
  const fileLinesCache = new Map<string, string[] | null>();

  return (filePath, line) => {
    if (!fileLinesCache.has(filePath)) fileLinesCache.set(filePath, readFileLines(filePath));
    const lines = fileLinesCache.get(filePath) ?? null;
    if (lines === null || line < 1 || line > lines.length) return null;
    return lines[line - 1] ?? null;
  };
};
