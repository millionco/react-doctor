import os from "node:os";

// The current user's home directory, replaced wholesale so absolute paths in
// telemetry (cwd, argv, stack frames, span attributes) don't carry the OS
// username — the primary personal identifier that leaks through file paths.
const HOME_DIRECTORY = os.homedir();

// Generic user-home roots, matched case-insensitively with either slash so a
// path belonging to another user — or captured when `os.homedir()` resolution
// fails — is still anonymized. Each captures the `<drive>:\Users|/Users|/home`
// root plus the username segment and collapses the lot to `~`. The Windows
// pattern runs first so the POSIX `/Users/` rule doesn't partially rewrite a
// forward-slash Windows path (`C:/Users/<name>`) into `C:~`.
const USER_HOME_PATTERNS: ReadonlyArray<RegExp> = [
  /[A-Za-z]:[\\/]Users[\\/][^\\/]+/gi,
  /(?:\/Users\/|\/home\/)[^/\\]+/gi,
];

/**
 * Replaces the user's home directory (and generic `/Users|/home|C:\Users\<name>`
 * roots) with `~` so absolute paths can't be tied back to an individual. Keeps
 * the path's relative structure intact, which stays useful for debugging while
 * dropping the personally-identifying prefix. Idempotent — re-running on an
 * already-scrubbed `~/...` path is a no-op.
 */
export const scrubSensitivePaths = (text: string): string => {
  let scrubbed = text;
  // Exact home directory first — covers non-standard roots (e.g. `/root`,
  // custom `$HOME`) that the generic patterns below don't anticipate.
  if (HOME_DIRECTORY.length > 1) {
    scrubbed = scrubbed.split(HOME_DIRECTORY).join("~");
  }
  for (const pattern of USER_HOME_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, "~");
  }
  return scrubbed;
};
