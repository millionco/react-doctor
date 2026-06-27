import * as fs from "node:fs";
import { isErrnoException } from "../utils/is-errno-exception.js";

// Discovery crawls an unknown tree best-effort: a directory we can't enumerate
// is skipped, never a crash. These are the "can't read this path" codes —
// missing/not-a-dir/permission-blocked, plus symlink loops, over-long paths, and
// filesystems that reject the scandir outright (`EINVAL`, REACT-DOCTOR-N).
const IGNORABLE_READDIR_ERROR_CODES = new Set([
  "EACCES",
  "EPERM",
  "ENOENT",
  "ENOTDIR",
  "EINVAL",
  "ELOOP",
  "ENAMETOOLONG",
]);

const isIgnorableReaddirError = (error: unknown): boolean =>
  isErrnoException(error) &&
  typeof error.code === "string" &&
  IGNORABLE_READDIR_ERROR_CODES.has(error.code);

export const readDirectoryEntries = (directoryPath: string): fs.Dirent[] => {
  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isIgnorableReaddirError(error)) return [];
    throw error;
  }
};

export const isFile = (filePath: string): boolean => {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};

export const isDirectory = (directoryPath: string): boolean => {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
};
