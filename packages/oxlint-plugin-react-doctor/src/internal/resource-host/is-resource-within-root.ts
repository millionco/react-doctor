import * as path from "node:path";

export const isResourceWithinRoot = (rootDirectory: string, resourcePath: string): boolean => {
  const relativePath = path.relative(rootDirectory, resourcePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};
