import fs from "node:fs";
import {
  SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES,
  SCAN_RESULT_CACHE_WORKSPACE_DEPENDENCY_SECTIONS,
} from "./constants.js";
import { getPackageJsonPath, isRecord, readPackageJson } from "./git-hook-shared.js";

export const canUseWorkspaceIndependentScanCache = (projectDirectory: string): boolean => {
  try {
    const canonicalDirectory = fs.realpathSync.native(projectDirectory);
    if (!fs.lstatSync(canonicalDirectory).isDirectory()) return false;
    const manifestPath = getPackageJsonPath(canonicalDirectory);
    const manifestStats = fs.lstatSync(manifestPath);
    if (
      !manifestStats.isFile() ||
      manifestStats.size > SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES
    ) {
      return false;
    }
    const manifest = readPackageJson(canonicalDirectory);
    if (!isRecord(manifest)) return false;
    for (const section of SCAN_RESULT_CACHE_WORKSPACE_DEPENDENCY_SECTIONS) {
      const dependencies = manifest[section];
      if (dependencies === undefined) continue;
      if (!isRecord(dependencies)) return false;
      for (const dependencyVersion of Object.values(dependencies)) {
        if (typeof dependencyVersion !== "string" || dependencyVersion === "workspace:*") {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
};
