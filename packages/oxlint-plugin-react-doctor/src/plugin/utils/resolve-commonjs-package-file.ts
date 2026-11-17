import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";

export const resolveCommonjsPackageFile = (
  fromFilename: string,
  source: string,
  packageDirectory: string,
): string | null => {
  if (!source.startsWith("./") && !source.startsWith("../")) return null;
  const requestedPath = path.resolve(path.dirname(fromFilename), source);
  const relativePath = path.relative(packageDirectory, requestedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  const extension = path.extname(requestedPath);
  if (extension && extension !== ".js") return null;
  recordExistenceProbe(requestedPath);
  try {
    const requestedEntry = fs.statSync(requestedPath, { throwIfNoEntry: false });
    if (requestedEntry)
      return extension === ".js" && requestedEntry.isFile() ? requestedPath : null;
    if (extension === ".js") return null;
    const javascriptPath = `${requestedPath}.js`;
    recordExistenceProbe(javascriptPath);
    return fs.statSync(javascriptPath, { throwIfNoEntry: false })?.isFile() ? javascriptPath : null;
  } catch {
    return null;
  }
};
