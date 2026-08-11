import * as path from "node:path";
import { toForwardSlashes } from "./path-format.js";

export const formatFindPath = (filePath: string, cwd: string): string => {
  const relativePath = path.relative(cwd, filePath);
  const displayPath =
    relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : filePath;
  return toForwardSlashes(displayPath);
};
