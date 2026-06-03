import * as path from "node:path";
import { filterSourceFiles } from "@react-doctor/core";
import type { DiffInfo } from "@react-doctor/core";
import { toForwardSlashes } from "./path-format.js";

export const resolveProjectDiffIncludePaths = (
  rootDirectory: string,
  projectDirectory: string,
  diffInfo: DiffInfo,
): string[] => {
  const changedSourceFiles = filterSourceFiles(diffInfo.changedFiles);
  const relativeProjectDirectory = toForwardSlashes(path.relative(rootDirectory, projectDirectory));

  if (relativeProjectDirectory.length === 0) return changedSourceFiles;
  if (relativeProjectDirectory.startsWith("../") || relativeProjectDirectory === "..") return [];
  if (path.isAbsolute(relativeProjectDirectory)) return [];

  const projectPrefix = `${relativeProjectDirectory}/`;
  return changedSourceFiles.flatMap((filePath) => {
    const normalizedFilePath = toForwardSlashes(filePath);
    if (!normalizedFilePath.startsWith(projectPrefix)) return [];
    const projectRelativePath = normalizedFilePath.slice(projectPrefix.length);
    return projectRelativePath.length > 0 ? [projectRelativePath] : [];
  });
};
