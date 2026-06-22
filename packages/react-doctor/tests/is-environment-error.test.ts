import { describe, expect, it } from "vite-plus/test";
import {
  formatEnvironmentError,
  isEnvironmentError,
} from "../src/cli/utils/is-environment-error.js";

const systemError = (code: string, extra: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(`${code}: simulated`), { code, ...extra });

describe("isEnvironmentError", () => {
  it("recognizes the unactionable filesystem codes", () => {
    for (const code of ["ENOSPC", "EIO", "EROFS", "EACCES", "EPERM", "ENOTDIR"]) {
      expect(isEnvironmentError(systemError(code, { syscall: "mkdir" }))).toBe(true);
    }
  });

  it("treats a spawn ENOENT (missing binary) as an environment error", () => {
    expect(isEnvironmentError(systemError("ENOENT", { syscall: "spawn git" }))).toBe(true);
  });

  it("does NOT treat a file ENOENT as an environment error (likely our bug)", () => {
    // A file we expected to exist being missing usually points at react-doctor,
    // not the user's machine — keep it reaching Sentry.
    expect(isEnvironmentError(systemError("ENOENT", { syscall: "open", path: "/missing" }))).toBe(
      false,
    );
  });

  it("does NOT treat ENAMETOOLONG as an environment error", () => {
    // An argv we built overflowing the OS limit is a batching bug we must fix,
    // not a user environment problem — it has to stay visible in Sentry.
    expect(isEnvironmentError(systemError("ENAMETOOLONG", { syscall: "spawn oxlint" }))).toBe(false);
  });

  it("does NOT treat other speculative codes as environment errors", () => {
    for (const code of ["EINVAL", "ELOOP", "EBUSY", "ESOMETHING"]) {
      expect(isEnvironmentError(systemError(code))).toBe(false);
    }
  });

  it("does not classify by message text (no stack-string sniffing)", () => {
    // A plain Error whose message merely contains a code must not be classified;
    // dispatch only on the structured `code`/`syscall` fields.
    expect(isEnvironmentError(new Error("EIO: i/o error, lstat '/tmp/file'"))).toBe(false);
    expect(isEnvironmentError(new Error("spawn oxlint ENOENT"))).toBe(false);
  });

  it("returns false for non-Error and codeless values", () => {
    expect(isEnvironmentError(new Error("Something went wrong"))).toBe(false);
    expect(isEnvironmentError("string error")).toBe(false);
    expect(isEnvironmentError(null)).toBe(false);
    expect(isEnvironmentError(undefined)).toBe(false);
  });
});

describe("formatEnvironmentError", () => {
  it("formats each environment code with an actionable message", () => {
    expect(formatEnvironmentError(systemError("ENOSPC"))).toBe(
      "No space left on device. Free up disk space and try again.",
    );
    expect(formatEnvironmentError(systemError("EIO"))).toBe(
      "I/O error: the filesystem or disk may be failing. Check your system logs.",
    );
    expect(formatEnvironmentError(systemError("EROFS"))).toBe(
      "Read-only filesystem: cannot write to this location.",
    );
    expect(formatEnvironmentError(systemError("ENOENT", { syscall: "spawn git" }))).toBe(
      "Required command not found. Ensure the tool (e.g. git) is installed and on your PATH.",
    );
  });

  it("includes the path in permission and not-a-directory messages when present", () => {
    expect(formatEnvironmentError(systemError("EACCES", { path: "/root/protected" }))).toBe(
      "Permission denied accessing /root/protected. Check file permissions and try again.",
    );
    expect(formatEnvironmentError(systemError("EPERM"))).toBe(
      "Permission denied. Check file permissions and try again.",
    );
    expect(formatEnvironmentError(systemError("ENOTDIR", { path: "/some/file.txt" }))).toBe(
      "A file exists at /some/file.txt or one of its parent paths where a directory was expected.",
    );
  });

  it("falls back to the raw message for non-system and non-Error values", () => {
    expect(formatEnvironmentError(new Error("Plain error message"))).toBe("Plain error message");
    expect(formatEnvironmentError("string error")).toBe("string error");
  });
});
