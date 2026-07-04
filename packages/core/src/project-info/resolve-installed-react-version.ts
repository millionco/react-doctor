import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { ancestorDirectories } from "../utils/ancestor-directories.js";
import { isPathInsideDirectory } from "../utils/is-path-inside-directory.js";
import { isProjectBoundary } from "../utils/is-project-boundary.js";
import { readPackageJson } from "./read-package-json.js";

/**
 * The nearest enclosing project boundary (git root or monorepo root), or
 * `directory` itself when the scan target sits outside any repo. Bounds the
 * node-resolution fallback so a React hoisted into the repo's `node_modules`
 * counts, but a globally installed React two directories above the working
 * tree cannot leak in.
 */
const findContainmentRoot = (directory: string): string => {
  for (const ancestor of ancestorDirectories(directory, { includeStart: true })) {
    if (isProjectBoundary(ancestor)) return ancestor;
  }

  return directory;
};

/**
 * Last-resort React detection: resolve `react/package.json` the way Node
 * itself would from `directory`, then read the installed version. Makes
 * "React is installed and importable" ⇒ "React is detected" an invariant for
 * packages whose only React declaration is a version-less spec (`workspace:*`,
 * `*`, a dist-tag) or where React lives solely in a hoisted `node_modules` the
 * declaration walks never reach — the profile of a component package inside a
 * monorepo.
 *
 * Guarded to installations physically inside the enclosing repo so a globally
 * installed React can't masquerade as the project's version. Returns `null`
 * when React isn't resolvable, resolves outside the repo, or carries no
 * version string.
 */
export const resolveInstalledReactVersion = (directory: string): string | null => {
  try {
    const resolvedReactPackageJsonPath = createRequire(
      path.join(directory, "package.json"),
    ).resolve("react/package.json");

    // Canonicalize BOTH paths through the same realpath so the containment
    // check compares like with like — on Windows `realpathSync.native` can
    // emit an extended-length (`\\?\`) or re-cased path that a raw resolver
    // path won't match, which would spuriously reject an in-repo install.
    const reactPackageJsonPath = fs.realpathSync.native(resolvedReactPackageJsonPath);
    const containmentRoot = fs.realpathSync.native(findContainmentRoot(directory));
    if (!isPathInsideDirectory(reactPackageJsonPath, containmentRoot)) return null;

    const installedVersion = readPackageJson(reactPackageJsonPath).version;
    return typeof installedVersion === "string" ? installedVersion : null;
  } catch {
    // Fail safe: any resolution / realpath failure leaves React undetected
    // (the pre-fallback behavior) rather than sinking discovery into an error.
    return null;
  }
};
