import * as path from "node:path";
import { ancestorDirectories } from "../utils/ancestor-directories.js";
import { isProjectBoundary } from "../utils/is-project-boundary.js";
import { isFile } from "./fs-utils.js";
import { readPackageJson } from "./package-json.js";

/**
 * Last-resort React detection: locate React the way Node's `node_modules`
 * resolution would from `directory` — check each `node_modules/react` up the
 * tree — but bounded to the enclosing repo so a globally installed React can't
 * masquerade as the project's version. Stops at (and including) the nearest
 * project boundary — the git root or a monorepo root — and returns the first
 * installed `version`.
 *
 * Makes "React is installed and importable" ⇒ "React is detected" an invariant
 * for packages whose only React declaration is a version-less spec
 * (`workspace:*`, `*`, a dist-tag) or where React lives solely in a hoisted
 * `node_modules` the declaration walks never reach — the profile of a component
 * package inside a monorepo. Matching the `node_modules/react` entry rather than
 * its realpath means a project whose `node_modules` is symlinked elsewhere (a
 * Docker volume, a shared store) still counts, while a global install outside
 * the repo does not.
 *
 * Returns `null` when React isn't installed within the repo or its package.json
 * carries no version string. A tree with no boundary marker at all bounds the
 * search to `directory`, so a dependency hoisted above the scanned package there
 * is conservatively not adopted.
 */
/**
 * The nearest enclosing project boundary (git root or monorepo root), or
 * `directory` itself when the scan target sits outside any repo. Bounds the
 * node_modules walk so a React hoisted anywhere inside the repo counts, but a
 * React in an ancestor above the repo — a home-directory or global
 * `node_modules` — can't leak in.
 */
const findContainmentRoot = (directory: string): string => {
  for (const ancestorDirectory of ancestorDirectories(directory, { includeStart: true })) {
    if (isProjectBoundary(ancestorDirectory)) return ancestorDirectory;
  }
  return directory;
};

export const resolveInstalledReactVersion = (directory: string): string | null => {
  const containmentRoot = findContainmentRoot(directory);

  for (const ancestorDirectory of ancestorDirectories(directory, { includeStart: true })) {
    const reactPackageJsonPath = path.join(
      ancestorDirectory,
      "node_modules",
      "react",
      "package.json",
    );
    if (isFile(reactPackageJsonPath)) {
      const installedVersion = readPackageJson(reactPackageJsonPath).version;
      return typeof installedVersion === "string" ? installedVersion : null;
    }
    // Stop after the containment root — its own node_modules (the hoist target)
    // was just checked, so anything higher is outside the repo.
    if (ancestorDirectory === containmentRoot) return null;
  }

  return null;
};
