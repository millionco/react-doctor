import * as path from "node:path";

export const isPathInsideDirectory = (
  childAbsolutePath: string,
  parentAbsolutePath: string,
): boolean => {
  const relativePath = path.relative(parentAbsolutePath, childAbsolutePath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
};
