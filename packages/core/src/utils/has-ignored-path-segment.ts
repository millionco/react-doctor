import { IGNORED_DIRECTORIES } from "../project-info/constants.js";

// True when any directory segment of a forward-slash relative path is one of
// the always-ignored directories (`dist`, `build`, `.next`, …). `git ls-files`
// happily lists COMMITTED build output — e.g. a package that checks its
// `dist/` bundles in — so the git discovery path needs the same directory
// exclusions the filesystem walk applies while descending. The final segment
// (the filename) is not a directory and is skipped.
export const hasIgnoredPathSegment = (relativePath: string): boolean =>
  relativePath
    .split("/")
    .slice(0, -1)
    .some((segment) => IGNORED_DIRECTORIES.has(segment));
