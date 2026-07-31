import * as path from "node:path";

export const isPathInside = (filePath: string, directory: string): boolean => {
  const relativePath = path.relative(directory, filePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
};
