import * as path from "node:path";

// Normalizes an absolute file path to a forward-slash path relative to
// the project root, or null when it escapes the project (so callers can
// skip paths outside the scanned tree).
export const toProjectRelative = (projectDirectory: string, filePath: string): string | null => {
  const relative = path.relative(projectDirectory, filePath).replace(/\\/g, "/");
  if (relative.length === 0 || relative.startsWith("../") || path.isAbsolute(relative)) return null;
  return relative;
};
