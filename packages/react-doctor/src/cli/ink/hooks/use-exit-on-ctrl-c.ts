import { useApp, useInput } from "ink";

const SHOW_CURSOR = "\u001B[?25h";

/**
 * Force-quits the whole CLI on Ctrl-C from any phase. Ink's built-in
 * `exitOnCtrlC` only unmounts the render — during a scan the in-flight
 * `inspect()` promise keeps the process alive, so Ctrl-C appears to do nothing.
 * Mounting this at the app root makes Ctrl-C always terminate: it restores the
 * terminal (raw mode off + cursor back) and exits with the conventional
 * 128+SIGINT code so the in-flight scan can't outlive the keystroke.
 */
export const useExitOnCtrlC = (): void => {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      // HACK: hard-exit from inside a React input handler. Ink's own teardown
      // can't run (the in-flight scan holds the event loop), so restore the
      // terminal by hand before process.exit.
      exit();
      process.stdin.setRawMode?.(false);
      process.stdout.write(SHOW_CURSOR);
      process.exit(130);
    }
  });
};
