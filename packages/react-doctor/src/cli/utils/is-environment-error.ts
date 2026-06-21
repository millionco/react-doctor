interface NodeSystemError extends Error {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
}

const isNodeSystemError = (error: unknown): error is NodeSystemError =>
  error instanceof Error && "code" in error && typeof (error as NodeSystemError).code === "string";

const ENVIRONMENT_ERROR_CODES = new Set([
  "ENOSPC",
  "EIO",
  "EACCES",
  "EPERM",
  "ENOTDIR",
  "ENOENT",
  "EINVAL",
  "ELOOP",
  "ENAMETOOLONG",
  "EROFS",
  "EBUSY",
]);

interface SpawnError extends Error {
  code?: string;
  cmd?: string;
}

const isSpawnError = (error: unknown): error is SpawnError =>
  error instanceof Error && "cmd" in error;

export const isEnvironmentError = (error: unknown): boolean => {
  if (isNodeSystemError(error) && error.code) {
    return ENVIRONMENT_ERROR_CODES.has(error.code);
  }

  if (isSpawnError(error) && error.code === "ENOENT") {
    return true;
  }

  if (error instanceof Error && error.message) {
    const message = error.message;
    for (const code of ENVIRONMENT_ERROR_CODES) {
      if (message.includes(`${code}:`)) {
        return true;
      }
    }
    if (message.includes("spawn") && message.includes("ENOENT")) {
      return true;
    }
  }

  return false;
};

export const formatEnvironmentError = (error: unknown): string => {
  if (!isNodeSystemError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const code = error.code ?? "unknown";
  const syscall = error.syscall;
  const path = error.path;

  switch (code) {
    case "ENOSPC":
      return "Disk full: No space left on device. Free up disk space and try again.";
    case "EIO":
      return "I/O error: The filesystem or disk may be failing. Check your system logs.";
    case "EACCES":
    case "EPERM":
      return path
        ? `Permission denied: Cannot access ${path}. Check file permissions.`
        : "Permission denied: Check file permissions and try again.";
    case "ENOTDIR":
      return path
        ? `Not a directory: ${path} is a file, not a directory.`
        : "Path component is not a directory.";
    case "ENOENT":
      if (syscall === "spawn" || error.message.includes("spawn")) {
        return "Command not found: A required tool is not installed or not in PATH.";
      }
      return path ? `File or directory not found: ${path}` : "File or directory not found.";
    case "EROFS":
      return "Read-only filesystem: Cannot write to this location.";
    case "EBUSY":
      return "Resource busy: A file or directory is in use by another process.";
    case "EINVAL":
    case "ELOOP":
    case "ENAMETOOLONG":
      return "Invalid filesystem path: The path is malformed or exceeds system limits.";
    default:
      return `Filesystem error (${code}): ${error.message}`;
  }
};
