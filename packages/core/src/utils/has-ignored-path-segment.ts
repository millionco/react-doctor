import { isIgnoredDirectoryName } from "./is-ignored-directory-name.js";

// True when any directory segment of a relative path is excluded by
// `isIgnoredDirectoryName` — an always-ignored directory (`dist`, `build`,
// `.next`, …) or a non-allowlisted hidden dot-directory (`.codex`,
// `.github`, …). `git ls-files` happily lists COMMITTED build output and
// tracked dot-directory tooling — e.g. a package that checks its `dist/`
// bundles in, or agent skills under `.codex/` — so the git discovery path
// needs the same directory exclusions the filesystem walk applies while
// descending. The final segment (the filename) is not a directory and is
// skipped. Splits on both separators because the disable-directive walk
// feeds raw `path.relative` output, which is backslash-separated on Windows.
export const hasIgnoredPathSegment = (relativePath: string): boolean =>
  relativePath
    .split(/[/\\]/)
    .slice(0, -1)
    .some((segment) => isIgnoredDirectoryName(segment));
