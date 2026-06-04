import * as fs from "node:fs";

/**
 * Resolves a path to its canonical, symlink-free form, falling back to
 * the input when it cannot be realpath'd (broken symlink, permission
 * error) so a best-effort normalization never throws.
 *
 * deslop's dead-code module graph is collected with `fast-glob` (which
 * keeps the scan root's symlinks intact) while imports are resolved
 * through `oxc-resolver` (which returns realpath'd targets). When the
 * project root sits behind a symlink — e.g. macOS iCloud-synced
 * `~/Documents` / `~/Desktop`, or a symlinked checkout — those two path
 * spaces diverge: every resolved import misses the graph and the files
 * they point at (commonly every `@/…` alias target) are mis-reported as
 * unreachable. Canonicalizing the root before the scan keeps both path
 * spaces in agreement.
 */
export const toCanonicalPath = (filePath: string): string => {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
};
