import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ImportReference } from "../types.js";
import { toPosixPath } from "./to-posix-path.js";

export const createImportGlobFilter = (
  importReference: ImportReference,
  fromFilePath: string,
): ((candidateFilePath: string) => boolean) => {
  if (!importReference.globFilterPattern || !importReference.globBaseDirectory) {
    return () => true;
  }

  const contextDirectory = resolve(dirname(fromFilePath), importReference.globBaseDirectory);
  let regularExpression: RegExp;
  try {
    regularExpression = new RegExp(
      importReference.globFilterPattern,
      importReference.globFilterFlags,
    );
  } catch {
    return () => false;
  }

  return (candidateFilePath: string): boolean => {
    const relativePath = relative(contextDirectory, candidateFilePath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) return false;
    regularExpression.lastIndex = 0;
    return regularExpression.test(`./${toPosixPath(relativePath)}`);
  };
};
