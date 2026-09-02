import * as path from "node:path";
import { filterSourceFiles, isDirectory, isFile, isPathInsideDirectory } from "@react-doctor/core";
import { CliInputError } from "./cli-input-error.js";
import { toForwardSlashes } from "./path-format.js";

export interface PositionalScanInput {
  readonly directory: string;
  readonly filePaths: string[] | undefined;
}

export const resolvePositionalScanInput = (
  positionalPaths: ReadonlyArray<string>,
  currentDirectory = process.cwd(),
): PositionalScanInput => {
  const absoluteCurrentDirectory = path.resolve(currentDirectory);
  if (positionalPaths.length === 0) {
    return { directory: absoluteCurrentDirectory, filePaths: undefined };
  }

  const onlyAbsolutePath = path.resolve(absoluteCurrentDirectory, positionalPaths[0]);
  const shouldUseDirectoryMode =
    positionalPaths.length === 1 &&
    (isDirectory(onlyAbsolutePath) ||
      (!isFile(onlyAbsolutePath) && filterSourceFiles([positionalPaths[0]]).length === 0));
  if (shouldUseDirectoryMode) {
    return { directory: positionalPaths[0], filePaths: undefined };
  }

  const uniqueFilePaths = new Set<string>();
  for (const positionalPath of positionalPaths) {
    const absolutePath = path.resolve(absoluteCurrentDirectory, positionalPath);
    if (isDirectory(absolutePath)) {
      throw new CliInputError(
        `Cannot combine the directory "${positionalPath}" with file path arguments. Pass one directory or only file paths.`,
      );
    }
    if (!isPathInsideDirectory(absolutePath, absoluteCurrentDirectory)) {
      throw new CliInputError(
        `The file path "${positionalPath}" is outside the current directory. Run React Doctor from a common project root.`,
      );
    }
    uniqueFilePaths.add(toForwardSlashes(path.relative(absoluteCurrentDirectory, absolutePath)));
  }

  return { directory: absoluteCurrentDirectory, filePaths: [...uniqueFilePaths] };
};
