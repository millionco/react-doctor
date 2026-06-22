interface NodeSystemError extends Error {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
}

const isNodeSystemError = (error: unknown): error is NodeSystemError =>
  error instanceof Error && typeof (error as NodeSystemError).code === "string";

// Filesystem conditions React Doctor cannot fix: a full or read-only disk, a
// failing disk, denied permissions, or a path blocked by an existing file.
// Deliberately narrow — codes that usually mean *our* bug stay OUT so they keep
// reaching Sentry: a file we expected is missing (file `ENOENT`), an argv we
// built overflows the OS limit (`ENAMETOOLONG` — fixed by batching, not by the
// user), a malformed path (`EINVAL`/`ELOOP`), etc.
const ENVIRONMENT_ERROR_CODES = new Set(["ENOSPC", "EIO", "EROFS", "EACCES", "EPERM", "ENOTDIR"]);

export const isEnvironmentError = (error: unknown): boolean => {
  if (!isNodeSystemError(error)) return false;
  // A spawn that can't find its binary is the user's environment (a tool isn't
  // installed / on PATH), not our bug — but scoped to `spawn` so a missing
  // *file* we tried to read still surfaces. (git is degraded gracefully
  // upstream; this covers any other tool we shell out to.)
  if (error.code === "ENOENT") return error.syscall?.startsWith("spawn") ?? false;
  return error.code !== undefined && ENVIRONMENT_ERROR_CODES.has(error.code);
};

export const formatEnvironmentError = (error: unknown): string => {
  if (!isNodeSystemError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  switch (error.code) {
    case "ENOSPC":
      return "No space left on device. Free up disk space and try again.";
    case "EIO":
      return "I/O error: the filesystem or disk may be failing. Check your system logs.";
    case "EROFS":
      return "Read-only filesystem: cannot write to this location.";
    case "EACCES":
    case "EPERM":
      return error.path
        ? `Permission denied accessing ${error.path}. Check file permissions and try again.`
        : "Permission denied. Check file permissions and try again.";
    case "ENOTDIR":
      return error.path
        ? `A file exists at ${error.path} or one of its parent paths where a directory was expected.`
        : "A file exists where a directory was expected.";
    case "ENOENT":
      return "Required command not found. Ensure the tool (e.g. git) is installed and on your PATH.";
    default:
      return error.message;
  }
};
