import * as path from "node:path";
import type { SourceFileEntry } from "../types/index.js";
import { listSourceFilesWithSizeCooperative } from "./list-source-files.js";

export const collectSourceFilesByDirectory = async (
  rootDirectory: string,
  projectDirectories: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, ReadonlyArray<SourceFileEntry>>> => {
  const resolvedRootDirectory = path.resolve(rootDirectory);
  const sourceFilesByDirectory = new Map<string, SourceFileEntry[]>();
  const projectDirectoryByRelativePath = new Map<string, string>();

  for (const projectDirectory of projectDirectories) {
    const resolvedProjectDirectory = path.resolve(projectDirectory);
    const relativeDirectory = path.relative(resolvedRootDirectory, resolvedProjectDirectory);
    if (
      path.isAbsolute(relativeDirectory) ||
      relativeDirectory === ".." ||
      relativeDirectory.startsWith(`..${path.sep}`)
    ) {
      continue;
    }
    sourceFilesByDirectory.set(resolvedProjectDirectory, []);
    projectDirectoryByRelativePath.set(
      relativeDirectory.replaceAll(path.sep, "/"),
      resolvedProjectDirectory,
    );
  }

  const sourceFiles = await listSourceFilesWithSizeCooperative(resolvedRootDirectory, signal);
  for (const sourceFile of sourceFiles) {
    let relativeDirectory = path.posix.dirname(sourceFile.path);
    while (true) {
      const normalizedRelativeDirectory = relativeDirectory === "." ? "" : relativeDirectory;
      const projectDirectory = projectDirectoryByRelativePath.get(normalizedRelativeDirectory);
      if (projectDirectory !== undefined) {
        const projectRelativePath = path.posix.relative(
          normalizedRelativeDirectory,
          sourceFile.path,
        );
        const projectSourceFiles = sourceFilesByDirectory.get(projectDirectory);
        if (projectSourceFiles === undefined) break;
        projectSourceFiles.push({
          path: projectRelativePath,
          sizeBytes: sourceFile.sizeBytes,
        });
        break;
      }
      if (relativeDirectory === ".") break;
      relativeDirectory = path.posix.dirname(relativeDirectory);
    }
  }

  return sourceFilesByDirectory;
};
