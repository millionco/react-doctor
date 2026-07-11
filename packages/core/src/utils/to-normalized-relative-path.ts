import * as path from "node:path";
import { toRelativePath } from "./to-relative-path.js";

export const toNormalizedRelativePath = (filePath: string, rootDirectory: string): string =>
  toRelativePath(path.resolve(rootDirectory, filePath), path.resolve(rootDirectory));
