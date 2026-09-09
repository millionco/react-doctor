import * as path from "node:path";
import { isPathInsideDirectory } from "@react-doctor/core";

export const resolveExcludedProjectDirectories = (
  scanDirectory: string,
  projectDirectories: ReadonlyArray<string>,
): string[] => {
  const excludedDirectories = new Map<string, string>();
  for (const projectDirectory of projectDirectories) {
    if (!isPathInsideDirectory(projectDirectory, scanDirectory)) continue;
    const resolvedDirectory = path.resolve(projectDirectory);
    if (!excludedDirectories.has(resolvedDirectory)) {
      excludedDirectories.set(resolvedDirectory, projectDirectory);
    }
  }
  return [...excludedDirectories.values()];
};
