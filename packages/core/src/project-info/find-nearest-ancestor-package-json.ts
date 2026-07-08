import * as path from "node:path";
import { ancestorDirectories } from "../utils/ancestor-directories.js";
import { isProjectBoundary } from "../utils/is-project-boundary.js";
import { isFile } from "./fs-utils.js";

/**
 * Walk up from `startDirectory` to the nearest ancestor that owns a
 * `package.json`, stopping at (and including) the enclosing project boundary
 * — the working tree's git root or a monorepo root. Lets a scan of a package
 * subfolder that has no `package.json` of its own adopt the nearest enclosing
 * package as its project root, so it inherits that package's dependency +
 * framework detection instead of synthesizing an empty (React-blind) project.
 *
 * Generalizes the older monorepo-root-only lookup: the nearest ancestor is the
 * most specific owning package (a leaf workspace, not just the repo root), so
 * a subfolder of one workspace no longer borrows a sibling's capabilities.
 *
 * Returns `null` when no ancestor `package.json` exists inside the project
 * boundary (a loose tree of files, or a subfolder of a package-less repo).
 */
export const findNearestAncestorPackageJson = (startDirectory: string): string | null => {
  // The scan directory itself has no `package.json` (the caller checked). If it
  // is already the project boundary — the git root or a monorepo root — don't
  // walk above it and adopt an unrelated `package.json` from outside the repo.
  if (isProjectBoundary(startDirectory)) return null;

  for (const directory of ancestorDirectories(startDirectory, { includeStart: false })) {
    if (isFile(path.join(directory, "package.json"))) return directory;
    if (isProjectBoundary(directory)) return null;
  }

  return null;
};
