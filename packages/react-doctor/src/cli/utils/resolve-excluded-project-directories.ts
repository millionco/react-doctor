import * as path from "node:path";
import { isPathInsideDirectory } from "@react-doctor/core";

export interface ResolveExcludedProjectDirectoriesInput {
  readonly scanDirectory: string;
  readonly selectedProjectDirectories: ReadonlyArray<string>;
  readonly workspaceProjectDirectories: ReadonlyArray<string>;
}

export const resolveExcludedProjectDirectories = (
  input: ResolveExcludedProjectDirectoriesInput,
): string[] => {
  const excludedDirectories = new Map<string, string>();
  for (const projectDirectory of [
    ...input.selectedProjectDirectories,
    ...input.workspaceProjectDirectories,
  ]) {
    if (!isPathInsideDirectory(projectDirectory, input.scanDirectory)) continue;
    const resolvedDirectory = path.resolve(projectDirectory);
    if (!excludedDirectories.has(resolvedDirectory)) {
      excludedDirectories.set(resolvedDirectory, projectDirectory);
    }
  }
  return [...excludedDirectories.values()];
};
