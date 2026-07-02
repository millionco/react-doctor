import { IGNORED_DIRECTORIES } from "../project-info/constants.js";

// True when any directory segment of a (forward- or back-slash) relative
// path is one of the always-ignored directories (`dist`, `build`, `.next`,
// …). `git ls-files` happily lists COMMITTED build output — e.g. a package
// that checks its `dist/` bundles in — so the git discovery path needs the
// same directory exclusions the filesystem walk applies while descending.
// The final segment (the filename) is not a directory and is skipped.
export const hasIgnoredPathSegment = (relativePath: string): boolean => {
  const segments = relativePath.split(/[/\\]/);
  for (let index = 0; index < segments.length - 1; index++) {
    if (IGNORED_DIRECTORIES.has(segments[index])) return true;
  }
  return false;
};
