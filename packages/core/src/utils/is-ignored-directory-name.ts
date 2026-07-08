import { IGNORED_DIRECTORIES, SCANNED_DOT_DIRECTORIES } from "../project-info/constants.js";

// THE directory-exclusion rule for source discovery, shared by the
// filesystem walk (`walkSourceTreeFiles`) and the git-listing filter
// (`hasIgnoredPathSegment`) so the two paths can never disagree: a
// directory is skipped when it's an always-ignored name (`dist`,
// `node_modules`, `.next`, …) or a hidden dot-directory outside the
// `SCANNED_DOT_DIRECTORIES` allowlist.
export const isIgnoredDirectoryName = (directoryName: string): boolean =>
  IGNORED_DIRECTORIES.has(directoryName) ||
  (directoryName.startsWith(".") && !SCANNED_DOT_DIRECTORIES.has(directoryName));
