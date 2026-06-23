import * as path from "node:path";

export interface IsPathInsideOptions {
  /** When `true`, `childPath` equal to `parentPath` counts as inside. */
  readonly allowSame?: boolean;
}

/**
 * `true` when `childPath` resolves within `parentPath`. By default the parent
 * directory itself does not count (the strict zip-slip guard); pass
 * `allowSame: true` to treat an exact match as inside (scope membership).
 *
 * Zip-Slip defense: relative paths can arrive from untrusted sources — a
 * crafted git index/pack/symlinked tree, or a reconstructed agent transcript —
 * and smuggle `..` segments that escape a temp root. Resolve against the parent
 * and reject anything that lands outside before writing. This is the one
 * audited copy of that guard, shared across the staged/baseline scan paths and
 * the stats reconstruction tree so the two cannot drift.
 */
export const isPathInside = (
  childPath: string,
  parentPath: string,
  options: IsPathInsideOptions = {},
): boolean => {
  const relative = path.relative(parentPath, childPath);
  if (!relative) return Boolean(options.allowSame);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};
