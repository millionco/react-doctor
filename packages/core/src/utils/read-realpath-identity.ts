import * as fs from "node:fs";

const EXECUTABLE_BITS = fs.constants.S_IXUSR | fs.constants.S_IXGRP | fs.constants.S_IXOTH;

export const readRealpathIdentity = (filename: string): string => {
  const resolvedPath = fs.realpathSync(filename);
  const stats = fs.statSync(resolvedPath);
  return stats.isFile() && (stats.mode & EXECUTABLE_BITS) !== 0
    ? resolvedPath + "\u0000executable"
    : resolvedPath;
};
