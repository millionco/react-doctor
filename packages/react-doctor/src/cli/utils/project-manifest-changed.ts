import type { DiffInfo } from "@react-doctor/core";
import { resolveProjectRelativeDirectory } from "./resolve-project-relative-directory.js";
import { toForwardSlashes } from "./path-format.js";

const PACKAGE_JSON = "package.json";

/**
 * True when the scanned project's own `package.json` is among the diff's
 * changed files. Shares `resolveProjectRelativeDirectory`'s boundary handling
 * with `resolveProjectDiffIncludePaths` so a workspace package matches only
 * its own manifest (not the monorepo root's or a sibling's) — which is exactly
 * what that project's per-project supply-chain check scores.
 */
export const projectManifestChanged = (
  rootDirectory: string,
  projectDirectory: string,
  diffInfo: DiffInfo,
): boolean => {
  const relativeProjectDirectory = resolveProjectRelativeDirectory(rootDirectory, projectDirectory);
  if (relativeProjectDirectory === null) return false;

  const manifestPath =
    relativeProjectDirectory.length === 0
      ? PACKAGE_JSON
      : `${relativeProjectDirectory}/${PACKAGE_JSON}`;
  return diffInfo.changedFiles.some((filePath) => toForwardSlashes(filePath) === manifestPath);
};
