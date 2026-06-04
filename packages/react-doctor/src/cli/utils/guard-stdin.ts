import { TERMINAL_HANGUP_EXIT_CODE } from "./constants.js";

// `errno` codes that mean the terminal/PTY backing the CLI went away while
// Node was reading stdin: closing the terminal tab/window, the parent shell
// exiting, an SSH/tmux/screen session detaching or dropping, the machine
// sleeping/waking, or the emulator being killed. On a real TTY the next
// `read()` returns one of these.
const TERMINAL_HANGUP_CODES = new Set(["EIO", "ENXIO"]);

/**
 * Handles a `process.stdin` `'error'` event. A terminal hangup mid-read
 * (`read EIO`) is environmental, not a bug, so exit like an interrupted run
 * instead of crashing. Re-throws anything else so genuine stdin failures keep
 * funneling to the crash reporter exactly as they did before this guard.
 */
export const handleStdinError = (error: NodeJS.ErrnoException): void => {
  if (error.code !== undefined && TERMINAL_HANGUP_CODES.has(error.code)) {
    process.exit(TERMINAL_HANGUP_EXIT_CODE);
  }
  throw error;
};

/**
 * Arms a `process.stdin` error guard at startup. The only thing that reads
 * stdin is the interactive `prompts` UI, which opens the TTY in raw mode and
 * never attaches an `'error'` listener of its own. Without a listener Node
 * turns a `read EIO` from a vanished terminal into a fatal uncaught exception
 * (reported to Sentry as a crash); with one, {@link handleStdinError} exits
 * cleanly on a hangup. Mirrors the stdout EPIPE guard in `cli/index.ts`.
 */
export const guardStdin = (): void => {
  process.stdin.on("error", handleStdinError);
};
