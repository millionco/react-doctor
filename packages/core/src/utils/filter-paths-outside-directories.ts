import * as path from "node:path";
import { isPathInsideDirectory } from "./is-path-inside-directory.js";

export interface FilterPathsOutsideDirectoriesInput {
  readonly rootDirectory: string;
  readonly relativePaths: ReadonlyArray<string>;
  readonly excludedDirectories: ReadonlyArray<string>;
}

export const filterPathsOutsideDirectories = (
  input: FilterPathsOutsideDirectoriesInput,
): string[] => {
  const excludedDirectories = input.excludedDirectories
    .map((excludedDirectory) => path.resolve(excludedDirectory))
    .filter((excludedDirectory) => isPathInsideDirectory(excludedDirectory, input.rootDirectory));
  if (excludedDirectories.length === 0) return [...input.relativePaths];

  return input.relativePaths.filter((relativePath) => {
    const absolutePath = path.resolve(input.rootDirectory, relativePath);
    return !excludedDirectories.some(
      (excludedDirectory) =>
        absolutePath === excludedDirectory ||
        isPathInsideDirectory(absolutePath, excludedDirectory),
    );
  });
};
