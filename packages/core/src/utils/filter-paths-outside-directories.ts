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
  const excludedPrefixes = input.excludedDirectories
    .map((excludedDirectory) => path.resolve(excludedDirectory))
    .filter((excludedDirectory) => isPathInsideDirectory(excludedDirectory, input.rootDirectory))
    .map((excludedDirectory) =>
      path.relative(input.rootDirectory, excludedDirectory).replaceAll("\\", "/"),
    )
    .sort((left, right) => left.length - right.length)
    .filter(
      (candidatePrefix, index, prefixes) =>
        !prefixes.slice(0, index).some((prefix) => candidatePrefix.startsWith(`${prefix}/`)),
    );
  if (excludedPrefixes.length === 0) return [...input.relativePaths];

  return input.relativePaths.filter((relativePath) => {
    const normalizedRelativePath = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
    return !excludedPrefixes.some(
      (excludedPrefix) =>
        normalizedRelativePath === excludedPrefix ||
        normalizedRelativePath.startsWith(`${excludedPrefix}/`),
    );
  });
};
