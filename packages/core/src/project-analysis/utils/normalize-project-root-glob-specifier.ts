import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { ViteProjectScope } from "../types.js";
import { toPosixPath } from "./to-posix-path.js";

const isPathInsideDirectory = (filePath: string, directory: string): boolean => {
  const relativeFilePath = relative(directory, filePath);
  return (
    relativeFilePath === "" ||
    (relativeFilePath !== ".." &&
      !relativeFilePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativeFilePath))
  );
};

export const normalizeProjectRootGlobSpecifier = (
  specifier: string,
  fromFilePath: string,
  projectRootDirectories: ReadonlyArray<string>,
  viteProjectScopes: ReadonlyArray<ViteProjectScope>,
): string => {
  if (!specifier.startsWith("/")) return specifier;
  const matchingViteProjectScopes = viteProjectScopes.filter(
    (viteProjectScope) =>
      isPathInsideDirectory(fromFilePath, viteProjectScope.rootDirectory) ||
      isPathInsideDirectory(fromFilePath, viteProjectScope.configDirectory),
  );
  const viteProjectRootDirectory = matchingViteProjectScopes.sort((leftScope, rightScope) => {
    const leftContainsRoot = isPathInsideDirectory(fromFilePath, leftScope.rootDirectory);
    const rightContainsRoot = isPathInsideDirectory(fromFilePath, rightScope.rootDirectory);
    if (leftContainsRoot !== rightContainsRoot) return leftContainsRoot ? -1 : 1;
    const leftOwnerDirectory = leftContainsRoot
      ? leftScope.rootDirectory
      : leftScope.configDirectory;
    const rightOwnerDirectory = rightContainsRoot
      ? rightScope.rootDirectory
      : rightScope.configDirectory;
    return rightOwnerDirectory.length - leftOwnerDirectory.length;
  })[0]?.rootDirectory;
  const projectRootDirectory =
    viteProjectRootDirectory ??
    projectRootDirectories
      .filter((candidateRootDirectory) =>
        isPathInsideDirectory(fromFilePath, candidateRootDirectory),
      )
      .sort((leftRoot, rightRoot) => rightRoot.length - leftRoot.length)[0];
  if (!projectRootDirectory) return specifier;
  const normalizedSpecifier = toPosixPath(
    relative(dirname(fromFilePath), join(projectRootDirectory, specifier.slice(1))),
  );
  return normalizedSpecifier.startsWith(".") ? normalizedSpecifier : `./${normalizedSpecifier}`;
};
