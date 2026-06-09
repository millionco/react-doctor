import * as path from "node:path";
import type { DiffInfo } from "@react-doctor/core";
import { toForwardSlashes } from "./path-format.js";

const PACKAGE_JSON = "package.json";

/**
 * True when the scanned project's own `package.json` is among the diff's
 * changed files. Mirrors `resolveProjectDiffIncludePaths`'s prefix handling so
 * a workspace package matches only its own manifest (not the monorepo root's
 * or a sibling's) — which is exactly what that project's per-project
 * supply-chain check scores.
 */
export const projectManifestChanged = (
  rootDirectory: string,
  projectDirectory: string,
  diffInfo: DiffInfo,
): boolean => {
  const relativeProjectDirectory = toForwardSlashes(path.relative(rootDirectory, projectDirectory));
  if (relativeProjectDirectory.startsWith("../") || relativeProjectDirectory === "..") return false;
  if (path.isAbsolute(relativeProjectDirectory)) return false;

  const manifestPath =
    relativeProjectDirectory.length === 0
      ? PACKAGE_JSON
      : `${relativeProjectDirectory}/${PACKAGE_JSON}`;
  return diffInfo.changedFiles.some((filePath) => toForwardSlashes(filePath) === manifestPath);
};
