import fs from "node:fs";
import path from "node:path";

/**
 * Builds a cached `(filePath, line) -> trimmed source text` reader rooted at
 * `rootDirectory`, used to fingerprint a diagnostic by the content of its
 * flagged line (see `computeDiagnosticDelta`). Files are read once and split;
 * unreadable files / out-of-range lines return `null`. `line` is 1-indexed,
 * matching diagnostic coordinates.
 */
export const createSourceLineReader = (
  rootDirectory: string,
): ((filePath: string, line: number) => string | null) => {
  const fileLinesCache = new Map<string, string[] | null>();

  const readLines = (filePath: string): string[] | null => {
    const cached = fileLinesCache.get(filePath);
    if (cached !== undefined) return cached;
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(rootDirectory, filePath);
    let lines: string[] | null;
    try {
      lines = fs.readFileSync(absolutePath, "utf8").split("\n");
    } catch {
      lines = null;
    }
    fileLinesCache.set(filePath, lines);
    return lines;
  };

  return (filePath, line) => {
    const lines = readLines(filePath);
    if (lines === null || line < 1 || line > lines.length) return null;
    return lines[line - 1] ?? null;
  };
};
