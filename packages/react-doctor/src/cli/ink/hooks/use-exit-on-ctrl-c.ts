import { useInput } from "ink";
import { METRIC } from "../../utils/constants.js";
import { exitGracefully } from "../../utils/exit-gracefully.js";
import { recordCount } from "../../utils/record-metric.js";

const SHOW_CURSOR = "\u001B[?25h";

export const useExitOnCtrlC = (): void => {
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      recordCount(METRIC.tuiCancelled, 1, { resourceFooter: true });
      process.stdin.setRawMode?.(false);
      process.stdout.write(SHOW_CURSOR);
      exitGracefully();
    }
  });
};
