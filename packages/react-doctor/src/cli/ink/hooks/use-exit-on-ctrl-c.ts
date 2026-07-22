import { useApp, useInput } from "ink";
import { exitGracefully } from "../../utils/exit-gracefully.js";

const SHOW_CURSOR = "\u001B[?25h";

/**
 * Force-quits the whole CLI on Ctrl-C from any phase. Ink's built-in
 * `exitOnCtrlC` only unmounts the render — during a scan the in-flight
 * `inspect()` promise keeps the process alive, so Ctrl-C appears to do nothing.
 * Mounting this at the app root makes Ctrl-C always terminate: it restores the
 * terminal and then uses the CLI's shared SIGINT exit path so the in-flight
 * scan can't outlive the keystroke.
 */
export const useExitOnCtrlC = (): void => {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      // HACK: the in-flight scan keeps the event loop alive after Ink exits, so
      // restore the terminal before using the CLI's shared hard-exit path.
      exit();
      process.stdin.setRawMode?.(false);
      process.stdout.write(SHOW_CURSOR);
      exitGracefully();
    }
  });
};
