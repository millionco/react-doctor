import * as path from "node:path";
import { listSourceFilesCooperative } from "./list-source-files.js";

export const collectSourceFileCountsByDirectory = async (
  rootDirectory: string,
  projectDirectories: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, number>> => {
  const resolvedRootDirectory = path.resolve(rootDirectory);
  const sourceFileCounts = new Map<string, number>();
  const projectDirectoryByRelativePath = new Map<string, string>();

  for (const projectDirectory of projectDirectories) {
    const resolvedProjectDirectory = path.resolve(projectDirectory);
    sourceFileCounts.set(resolvedProjectDirectory, 0);
    const relativeDirectory = path.relative(resolvedRootDirectory, resolvedProjectDirectory);
    if (path.isAbsolute(relativeDirectory) || relativeDirectory.startsWith("..")) continue;
    projectDirectoryByRelativePath.set(
      relativeDirectory.replaceAll(path.sep, "/"),
      resolvedProjectDirectory,
    );
  }

  const sourceFilePaths = await listSourceFilesCooperative(resolvedRootDirectory, signal);
  for (const sourceFilePath of sourceFilePaths) {
    let relativeDirectory = path.posix.dirname(sourceFilePath);
    while (true) {
      const normalizedRelativeDirectory = relativeDirectory === "." ? "" : relativeDirectory;
      const projectDirectory = projectDirectoryByRelativePath.get(normalizedRelativeDirectory);
      if (projectDirectory !== undefined) {
        sourceFileCounts.set(projectDirectory, (sourceFileCounts.get(projectDirectory) ?? 0) + 1);
      }
      if (relativeDirectory === ".") break;
      relativeDirectory = path.posix.dirname(relativeDirectory);
    }
  }

  return sourceFileCounts;
};
