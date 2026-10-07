import { isErrnoException, isReactDoctorError, messageFromUnknown } from "@react-doctor/core";

// Filesystem conditions React Doctor cannot fix: a full or read-only disk, a
// failing disk, denied permissions, or a path blocked by an existing file.
// Deliberately narrow — codes that usually mean *our* bug stay OUT so they keep
// reaching Sentry: a file we expected is missing (file `ENOENT`), an argv we
// built overflows the OS limit (`ENAMETOOLONG` — fixed by batching, not by the
// user), a malformed path (`EINVAL`/`ELOOP`), etc.
const ENVIRONMENT_ERROR_CODES = new Set(["EACCES", "EIO", "ENOSPC", "ENOTDIR", "EPERM", "EROFS"]);
const ENVIRONMENT_FILESYSTEM_SYSCALLS = new Set([
  "lstat",
  "open",
  "read",
  "readdir",
  "readlink",
  "realpath",
  "scandir",
  "stat",
]);
const TRANSIENT_FILESYSTEM_ERROR_CODES = new Set(["EBUSY", "ETIMEDOUT", "UNKNOWN"]);

const findEnvironmentError = (error: unknown): NodeJS.ErrnoException | null => {
  const pendingErrors: unknown[] = [error];
  const visitedErrors = new Set<object>();

  while (pendingErrors.length > 0) {
    const currentError = pendingErrors.pop();
    if (typeof currentError !== "object" || currentError === null) continue;
    if (visitedErrors.has(currentError)) continue;
    visitedErrors.add(currentError);

    if (isErrnoException(currentError) && typeof currentError.code === "string") {
      const syscall = currentError.syscall ?? "";
      if (
        ENVIRONMENT_ERROR_CODES.has(currentError.code) ||
        (currentError.code === "ENOENT" && syscall.startsWith("spawn")) ||
        (TRANSIENT_FILESYSTEM_ERROR_CODES.has(currentError.code) &&
          ENVIRONMENT_FILESYSTEM_SYSCALLS.has(syscall))
      ) {
        return currentError;
      }
    }

    if (currentError instanceof Error && currentError.cause !== undefined) {
      pendingErrors.push(currentError.cause);
    }
    if (isReactDoctorError(currentError) && "cause" in currentError.reason) {
      pendingErrors.push(currentError.reason.cause);
    }
  }

  return null;
};

export const isEnvironmentError = (error: unknown): boolean => findEnvironmentError(error) !== null;

export const formatEnvironmentError = (error: unknown): string => {
  const environmentError = findEnvironmentError(error);
  if (!environmentError) return messageFromUnknown(error);

  switch (environmentError.code) {
    case "EBUSY":
      return environmentError.path
        ? `Resource busy or locked at ${environmentError.path}. Close the process using it and try again.`
        : "Resource busy or locked. Close the process using it and try again.";
    case "ENOSPC":
      return "No space left on device. Free up disk space and try again.";
    case "EIO":
      return "I/O error: the filesystem or disk may be failing. Check your system logs.";
    case "EROFS":
      return "Read-only filesystem: cannot write to this location.";
    case "EACCES":
    case "EPERM":
      return environmentError.path
        ? `Permission denied accessing ${environmentError.path}. Check file permissions and try again.`
        : "Permission denied. Check file permissions and try again.";
    case "ENOTDIR":
      return environmentError.path
        ? `A file exists at ${environmentError.path} or one of its parent paths where a directory was expected.`
        : "A file exists where a directory was expected.";
    case "ENOENT":
      return "Required command not found. Ensure the tool (e.g. git) is installed and on your PATH.";
    case "ETIMEDOUT":
      return environmentError.path
        ? `Timed out accessing ${environmentError.path}. Check the network or cloud drive and try again.`
        : "Filesystem access timed out. Check the network or cloud drive and try again.";
    case "UNKNOWN":
      return environmentError.path
        ? `The operating system could not access ${environmentError.path}. Check the filesystem and try again.`
        : "The operating system could not access the filesystem. Check it and try again.";
    default:
      return environmentError.message;
  }
};
