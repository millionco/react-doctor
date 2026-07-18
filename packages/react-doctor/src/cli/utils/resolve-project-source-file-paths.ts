import { filterSourceFiles } from "@react-doctor/core";
import { toForwardSlashes } from "./path-format.js";
import { resolveProjectRelativeDirectory } from "./resolve-project-relative-directory.js";

export const resolveProjectSourceFilePaths = (
  rootDirectory: string,
  projectDirectory: string,
  filePaths: ReadonlyArray<string>,
): string[] => {
  const relativeProjectDirectory = resolveProjectRelativeDirectory(rootDirectory, projectDirectory);
  if (relativeProjectDirectory === null) return [];

  const sourceFilePaths = filterSourceFiles([...filePaths]);
  if (relativeProjectDirectory.length === 0) return sourceFilePaths;

  const projectPrefix = `${relativeProjectDirectory}/`;
  return sourceFilePaths.flatMap((filePath) => {
    const normalizedFilePath = toForwardSlashes(filePath);
    if (!normalizedFilePath.startsWith(projectPrefix)) return [];
    const projectRelativePath = normalizedFilePath.slice(projectPrefix.length);
    return projectRelativePath.length > 0 ? [projectRelativePath] : [];
  });
};
