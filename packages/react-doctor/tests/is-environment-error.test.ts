import { describe, expect, it } from "vite-plus/test";
import { formatEnvironmentError, isEnvironmentError } from "../src/cli/utils/is-environment-error.js";

describe("isEnvironmentError", () => {
  it("recognizes ENOSPC errors", () => {
    const error = Object.assign(new Error("ENOSPC: no space left on device"), {
      code: "ENOSPC",
      syscall: "mkdir",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes EIO errors", () => {
    const error = Object.assign(new Error("EIO: i/o error"), {
      code: "EIO",
      syscall: "lstat",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes EACCES errors", () => {
    const error = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
      syscall: "open",
      path: "/root/protected",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes EPERM errors", () => {
    const error = Object.assign(new Error("EPERM: operation not permitted"), {
      code: "EPERM",
      syscall: "mkdir",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes ENOTDIR errors", () => {
    const error = Object.assign(new Error("ENOTDIR: not a directory"), {
      code: "ENOTDIR",
      path: "/some/file.txt",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes ENOENT errors", () => {
    const error = Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
      path: "/missing/path",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes EROFS errors", () => {
    const error = Object.assign(new Error("EROFS: read-only file system"), {
      code: "EROFS",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes EBUSY errors", () => {
    const error = Object.assign(new Error("EBUSY: resource busy or locked"), {
      code: "EBUSY",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes EINVAL errors", () => {
    const error = Object.assign(new Error("EINVAL: invalid argument"), {
      code: "EINVAL",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes ELOOP errors", () => {
    const error = Object.assign(new Error("ELOOP: too many symbolic links encountered"), {
      code: "ELOOP",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes ENAMETOOLONG errors", () => {
    const error = Object.assign(new Error("ENAMETOOLONG: name too long"), {
      code: "ENAMETOOLONG",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes spawn ENOENT errors by code", () => {
    const error = Object.assign(new Error("spawn git ENOENT"), {
      code: "ENOENT",
      cmd: "git",
    });
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes spawn ENOENT errors by message pattern", () => {
    const error = new Error("spawn oxlint ENOENT");
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("recognizes error codes in message text", () => {
    const error = new Error("EIO: i/o error, lstat '/tmp/file'");
    expect(isEnvironmentError(error)).toBe(true);
  });

  it("returns false for non-environment errors", () => {
    const error = new Error("Something went wrong");
    expect(isEnvironmentError(error)).toBe(false);
  });

  it("returns false for non-Error objects", () => {
    expect(isEnvironmentError("string error")).toBe(false);
    expect(isEnvironmentError(null)).toBe(false);
    expect(isEnvironmentError(undefined)).toBe(false);
  });

  it("returns false for errors with non-environment codes", () => {
    const error = Object.assign(new Error("ESOMETHING: custom error"), {
      code: "ESOMETHING",
    });
    expect(isEnvironmentError(error)).toBe(false);
  });
});

describe("formatEnvironmentError", () => {
  it("formats ENOSPC errors with actionable message", () => {
    const error = Object.assign(new Error("ENOSPC: no space left on device"), {
      code: "ENOSPC",
      syscall: "mkdir",
    });
    expect(formatEnvironmentError(error)).toBe(
      "Disk full: No space left on device. Free up disk space and try again.",
    );
  });

  it("formats EIO errors with system check message", () => {
    const error = Object.assign(new Error("EIO: i/o error"), {
      code: "EIO",
      syscall: "lstat",
    });
    expect(formatEnvironmentError(error)).toBe(
      "I/O error: The filesystem or disk may be failing. Check your system logs.",
    );
  });

  it("formats EACCES errors with path when available", () => {
    const error = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
      path: "/root/protected",
    });
    expect(formatEnvironmentError(error)).toBe(
      "Permission denied: Cannot access /root/protected. Check file permissions.",
    );
  });

  it("formats EACCES errors without path", () => {
    const error = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    expect(formatEnvironmentError(error)).toBe(
      "Permission denied: Check file permissions and try again.",
    );
  });

  it("formats EPERM errors with path when available", () => {
    const error = Object.assign(new Error("EPERM: operation not permitted"), {
      code: "EPERM",
      path: "/protected/file",
    });
    expect(formatEnvironmentError(error)).toBe(
      "Permission denied: Cannot access /protected/file. Check file permissions.",
    );
  });

  it("formats ENOTDIR errors with path", () => {
    const error = Object.assign(new Error("ENOTDIR: not a directory"), {
      code: "ENOTDIR",
      path: "/some/file.txt",
    });
    expect(formatEnvironmentError(error)).toBe(
      "Not a directory: /some/file.txt is a file, not a directory.",
    );
  });

  it("formats spawn ENOENT errors", () => {
    const error = Object.assign(new Error("spawn git ENOENT"), {
      code: "ENOENT",
      syscall: "spawn",
    });
    expect(formatEnvironmentError(error)).toBe(
      "Command not found: A required tool is not installed or not in PATH.",
    );
  });

  it("formats file ENOENT errors with path", () => {
    const error = Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
      path: "/missing/file",
    });
    expect(formatEnvironmentError(error)).toBe("File or directory not found: /missing/file");
  });

  it("formats EROFS errors", () => {
    const error = Object.assign(new Error("EROFS: read-only file system"), {
      code: "EROFS",
    });
    expect(formatEnvironmentError(error)).toBe(
      "Read-only filesystem: Cannot write to this location.",
    );
  });

  it("formats EBUSY errors", () => {
    const error = Object.assign(new Error("EBUSY: resource busy"), {
      code: "EBUSY",
    });
    expect(formatEnvironmentError(error)).toBe(
      "Resource busy: A file or directory is in use by another process.",
    );
  });

  it("formats EINVAL errors", () => {
    const error = Object.assign(new Error("EINVAL: invalid argument"), {
      code: "EINVAL",
    });
    expect(formatEnvironmentError(error)).toBe(
      "Invalid filesystem path: The path is malformed or exceeds system limits.",
    );
  });

  it("formats unknown error codes with fallback", () => {
    const error = Object.assign(new Error("EUNKNOWN: unknown error"), {
      code: "EUNKNOWN",
    });
    expect(formatEnvironmentError(error)).toBe("Filesystem error (EUNKNOWN): EUNKNOWN: unknown error");
  });

  it("handles non-NodeSystemError objects", () => {
    const error = new Error("Plain error message");
    expect(formatEnvironmentError(error)).toBe("Plain error message");
  });

  it("handles non-Error values", () => {
    expect(formatEnvironmentError("string error")).toBe("string error");
  });
});
