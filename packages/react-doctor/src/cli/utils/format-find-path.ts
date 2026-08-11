import * as path from "node:path";

export const formatFindPath = (filePath: string, cwd: string): string => {
  const relativePath = path.relative(cwd, filePath);
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : filePath;
};
