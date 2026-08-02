import { useApp, useInput } from "ink";
import { METRIC } from "../../utils/constants.js";
import { exitGracefully } from "../../utils/exit-gracefully.js";
import { recordCount } from "../../utils/record-metric.js";

const SHOW_CURSOR = "\u001B[?25h";

export const useExitOnCtrlC = (): void => {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      recordCount(METRIC.tuiCancelled, 1, { resourceFooter: true });
      // HACK: the in-flight scan keeps the event loop alive after Ink exits, so
      // restore the terminal before using the CLI's shared hard-exit path.
      exit();
      process.stdin.setRawMode?.(false);
      process.stdout.write(SHOW_CURSOR);
      exitGracefully();
    }
  });
};
