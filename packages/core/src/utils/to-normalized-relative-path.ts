import * as path from "node:path";

export const toNormalizedRelativePath = (filePath: string, rootDirectory: string): string =>
  path
    .relative(path.resolve(rootDirectory), path.resolve(rootDirectory, filePath))
    .replaceAll("\\", "/") || ".";
