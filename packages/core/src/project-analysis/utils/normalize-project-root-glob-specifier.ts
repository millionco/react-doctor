import { dirname, join, relative } from "node:path";
import type { ViteProjectScope } from "../types.js";
import { isPathInsideDirectoryOrEqual } from "./is-path-inside-directory-or-equal.js";
import { toPosixPath } from "./to-posix-path.js";

export const normalizeProjectRootGlobSpecifier = (
  specifier: string,
  fromFilePath: string,
  projectRootDirectories: ReadonlyArray<string>,
  viteProjectScopes: ReadonlyArray<ViteProjectScope>,
): string => {
  if (!specifier.startsWith("/")) return specifier;
  const matchingViteProjectScopes = viteProjectScopes.filter(
    (viteProjectScope) =>
      isPathInsideDirectoryOrEqual(fromFilePath, viteProjectScope.rootDirectory) ||
      isPathInsideDirectoryOrEqual(fromFilePath, viteProjectScope.configDirectory),
  );
  const viteProjectRootDirectory = matchingViteProjectScopes.sort((leftScope, rightScope) => {
    const leftContainsRoot = isPathInsideDirectoryOrEqual(fromFilePath, leftScope.rootDirectory);
    const rightContainsRoot = isPathInsideDirectoryOrEqual(fromFilePath, rightScope.rootDirectory);
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
        isPathInsideDirectoryOrEqual(fromFilePath, candidateRootDirectory),
      )
      .sort((leftRoot, rightRoot) => rightRoot.length - leftRoot.length)[0];
  if (!projectRootDirectory) return specifier;
  const normalizedSpecifier = toPosixPath(
    relative(dirname(fromFilePath), join(projectRootDirectory, specifier.slice(1))),
  );
  return normalizedSpecifier.startsWith(".") ? normalizedSpecifier : `./${normalizedSpecifier}`;
};
