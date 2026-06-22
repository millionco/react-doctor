import * as path from "node:path";

export interface IsPathInsideOptions {
  /** When `true`, `childPath` equal to `parentPath` counts as inside. */
  readonly allowSame?: boolean;
}

/**
 * `true` when `childPath` resolves within `parentPath`. By default the parent
 * directory itself does not count (the strict zip-slip guard); pass
 * `allowSame: true` to treat an exact match as inside (scope membership).
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
