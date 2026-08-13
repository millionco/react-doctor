import { posix } from "node:path";
import { toPosixPath } from "./to-posix-path.js";

export const isPathInsideDirectoryOrEqual = (
  candidatePath: string,
  directoryPath: string,
): boolean => {
  const normalizedCandidatePath = posix.normalize(toPosixPath(candidatePath));
  const normalizedDirectoryPath = posix.normalize(toPosixPath(directoryPath));
  const relativePath = posix.relative(normalizedDirectoryPath, normalizedCandidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith("../") && !posix.isAbsolute(relativePath))
  );
};
