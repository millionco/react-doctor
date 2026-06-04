import * as fs from "node:fs";

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

const isIgnorableReaddirError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const errorCode = (error as NodeJS.ErrnoException).code;
  return typeof errorCode === "string" && IGNORABLE_READDIR_ERROR_CODES.has(errorCode);
};

export const readDirectoryEntries = (directoryPath: string): fs.Dirent[] => {
  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isIgnorableReaddirError(error)) return [];
    throw error;
  }
};
