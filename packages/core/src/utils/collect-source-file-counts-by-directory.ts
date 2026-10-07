import { collectSourceFilesByDirectory } from "./collect-source-files-by-directory.js";

export const collectSourceFileCountsByDirectory = async (
  rootDirectory: string,
  projectDirectories: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, number>> => {
  const sourceFilesByDirectory = await collectSourceFilesByDirectory(
    rootDirectory,
    projectDirectories,
    signal,
  );
  const sourceFileCounts = new Map<string, number>();
  for (const [projectDirectory, sourceFiles] of sourceFilesByDirectory) {
    sourceFileCounts.set(projectDirectory, sourceFiles.length);
  }
  return sourceFileCounts;
};
