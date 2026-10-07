import { toPosixPath } from "./to-posix-path.js";

export const buildExportKey = (filePath: string, exportName: string): string =>
  `${toPosixPath(filePath)}::${exportName}`;
