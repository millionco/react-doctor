import * as path from "node:path";
import { normalizeFilename } from "../../plugin/utils/normalize-filename.js";

export const normalizeResourcePath = (rootDirectory: string, resourcePath: string): string =>
  normalizeFilename(path.resolve(rootDirectory, normalizeFilename(resourcePath)));
