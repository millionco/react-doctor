import * as path from "node:path";
import {
  collectSourceFilesByDirectory,
  findMonorepoRoot,
  isMonorepoRoot,
  isPathInsideDirectory,
} from "@react-doctor/core";
import type { ProjectDefinition, SourceFileEntry } from "@react-doctor/core";

export interface DiagnoseProjectPlanEntry {
  readonly originalIndex: number;
  readonly projectDefinition: ProjectDefinition;
  readonly precomputedSourceFiles?: ReadonlyArray<SourceFileEntry>;
}

const resolveProjectGroupRoot = (projectDirectory: string): string | null => {
  try {
    return isMonorepoRoot(projectDirectory) ? projectDirectory : findMonorepoRoot(projectDirectory);
  } catch {
    return null;
  }
};

const containsNestedProjectDirectories = (projectDirectories: ReadonlyArray<string>): boolean =>
  projectDirectories.some((projectDirectory, projectIndex) =>
    projectDirectories.some(
      (candidateDirectory, candidateIndex) =>
        candidateIndex !== projectIndex &&
        isPathInsideDirectory(candidateDirectory, projectDirectory),
    ),
  );

const resolveCommonAncestorDirectory = (projectDirectories: ReadonlyArray<string>): string => {
  let commonDirectory = projectDirectories[0];
  for (const projectDirectory of projectDirectories.slice(1)) {
    while (
      commonDirectory !== projectDirectory &&
      !isPathInsideDirectory(projectDirectory, commonDirectory)
    ) {
      commonDirectory = path.dirname(commonDirectory);
    }
  }
  return commonDirectory;
};

const collectGroupSourceFiles = async (
  projectDirectories: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<SourceFileEntry>>> => {
  if (projectDirectories.length === 1 || containsNestedProjectDirectories(projectDirectories)) {
    return new Map();
  }
  try {
    return await collectSourceFilesByDirectory(
      resolveCommonAncestorDirectory(projectDirectories),
      projectDirectories,
    );
  } catch {
    return new Map();
  }
};

const compareProjectPlanEntries = (
  leftEntry: DiagnoseProjectPlanEntry,
  rightEntry: DiagnoseProjectPlanEntry,
): number => {
  const leftSourceFileCount = leftEntry.precomputedSourceFiles?.length;
  const rightSourceFileCount = rightEntry.precomputedSourceFiles?.length;
  if (leftSourceFileCount === rightSourceFileCount) {
    return leftEntry.originalIndex - rightEntry.originalIndex;
  }
  if (leftSourceFileCount === undefined) return 1;
  if (rightSourceFileCount === undefined) return -1;
  return rightSourceFileCount - leftSourceFileCount;
};

export const buildDiagnoseProjectPlan = async (
  projects: ReadonlyArray<ProjectDefinition>,
): Promise<DiagnoseProjectPlanEntry[]> => {
  const projectDirectoriesByRootDirectory = new Map<string, string[]>();
  for (const project of projects) {
    const projectDirectory = path.resolve(project.directory);
    const rootDirectory = resolveProjectGroupRoot(projectDirectory);
    if (rootDirectory === null) continue;
    const projectDirectories = projectDirectoriesByRootDirectory.get(rootDirectory);
    if (projectDirectories === undefined) {
      projectDirectoriesByRootDirectory.set(rootDirectory, [projectDirectory]);
    } else {
      projectDirectories.push(projectDirectory);
    }
  }

  const groupedSourceFiles = await Promise.all(
    [...projectDirectoriesByRootDirectory.values()].map(collectGroupSourceFiles),
  );
  const sourceFilesByDirectory = new Map<string, ReadonlyArray<SourceFileEntry>>();
  for (const sourceFilesByProjectDirectory of groupedSourceFiles) {
    for (const [projectDirectory, sourceFiles] of sourceFilesByProjectDirectory) {
      if (sourceFiles.length === 0) continue;
      sourceFilesByDirectory.set(projectDirectory, sourceFiles);
    }
  }

  return projects
    .map((projectDefinition, originalIndex): DiagnoseProjectPlanEntry => {
      const precomputedSourceFiles = sourceFilesByDirectory.get(
        path.resolve(projectDefinition.directory),
      );
      return {
        originalIndex,
        projectDefinition,
        ...(precomputedSourceFiles === undefined ? {} : { precomputedSourceFiles }),
      };
    })
    .toSorted(compareProjectPlanEntries);
};
