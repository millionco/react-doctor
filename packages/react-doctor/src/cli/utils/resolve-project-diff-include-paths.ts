import { filterSourceFiles } from "@react-doctor/core";
import type { DiffInfo } from "@react-doctor/core";
import { resolveProjectRelativeDirectory } from "./resolve-project-relative-directory.js";
import { toForwardSlashes } from "./path-format.js";

export const resolveProjectDiffIncludePaths = (
  rootDirectory: string,
  projectDirectory: string,
  diffInfo: DiffInfo,
): string[] => {
  const relativeProjectDirectory = resolveProjectRelativeDirectory(rootDirectory, projectDirectory);
  if (relativeProjectDirectory === null) return [];

  const changedSourceFiles = filterSourceFiles(diffInfo.changedFiles);
  if (relativeProjectDirectory.length === 0) return changedSourceFiles;

  const projectPrefix = `${relativeProjectDirectory}/`;
  return changedSourceFiles.flatMap((filePath) => {
    const normalizedFilePath = toForwardSlashes(filePath);
    if (!normalizedFilePath.startsWith(projectPrefix)) return [];
    const projectRelativePath = normalizedFilePath.slice(projectPrefix.length);
    return projectRelativePath.length > 0 ? [projectRelativePath] : [];
  });
};
