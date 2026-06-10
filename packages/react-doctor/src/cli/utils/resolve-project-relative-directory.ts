import * as path from "node:path";
import { toForwardSlashes } from "./path-format.js";

/**
 * The scanned project's directory relative to the diff root, forward-slashed —
 * or `null` when the project resolves outside the root (a `..` segment or an
 * absolute path, neither of which can be matched against repo-relative changed
 * files). An empty string means the project *is* the diff root. Shared by the
 * diff helpers that map changed files to a workspace (`resolveProjectDiffIncludePaths`,
 * `projectManifestChanged`) so the boundary rule lives in one place.
 */
export const resolveProjectRelativeDirectory = (
  rootDirectory: string,
  projectDirectory: string,
): string | null => {
  const relativeProjectDirectory = toForwardSlashes(path.relative(rootDirectory, projectDirectory));
  if (relativeProjectDirectory === ".." || relativeProjectDirectory.startsWith("../")) return null;
  if (path.isAbsolute(relativeProjectDirectory)) return null;
  return relativeProjectDirectory;
};
