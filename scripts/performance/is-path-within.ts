import * as fs from "node:fs";
import * as path from "node:path";

const canonicalizePath = (inputPath: string): string => {
  let existingPath = path.resolve(inputPath);
  const missingSegments: string[] = [];
  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) return path.resolve(inputPath);
    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }
  return path.join(fs.realpathSync.native(existingPath), ...missingSegments);
};

export const isPathWithin = (parentPath: string, candidatePath: string): boolean => {
  const relativePath = path.relative(canonicalizePath(parentPath), canonicalizePath(candidatePath));
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
};
