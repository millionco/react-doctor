import * as fs from "node:fs";

/**
 * Resolves a path to its canonical, symlink-free form, falling back to
 * the input when it cannot be realpath'd (broken symlink, permission
 * error) so a best-effort normalization never throws.
 *
 * Canonicalizing the root keeps file discovery and module resolution in the
 * same path space when a project sits behind a symlink.
 */
export const toCanonicalPath = (filePath: string): string => {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
};
