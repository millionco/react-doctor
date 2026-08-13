import { isAbsolute, relative, sep } from "node:path";

export const isPathInsideDirectoryOrEqual = (
  candidatePath: string,
  directoryPath: string,
): boolean => {
  const relativePath = relative(directoryPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
};
