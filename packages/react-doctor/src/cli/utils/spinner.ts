import ora from "ora";
import { SPINNER_INDENT_CHARS } from "@react-doctor/core";
import { isSpinnerInteractive } from "./is-spinner-interactive.js";

let isSilent = false;

export const setSpinnerSilent = (silent: boolean): void => {
  isSilent = silent;
};

export const isSpinnerSilent = (): boolean => isSilent;

const noopHandle = Object.freeze({
  update: () => {},
  succeed: () => {},
  fail: () => {},
});

export const spinner = (text: string) => ({
  start() {
    if (isSilent) return noopHandle;

    // HACK: ora renders to `stderr` by default and computes lines-to-
    // clear with `Math.ceil(width / stream.columns)`. In a Git pre-push
    // hook or under `script(1)`, stderr inherits the TTY but `columns`
    // is 0, producing `Infinity` clears and pegging a core (issue #293).
    // `isSpinnerInteractive` demotes ora to one-shot succeed/fail lines
    // in that case (and in CI, agent shells, git hooks via `GIT_DIR`,
    // and `TERM=dumb`). Stream and guard share one fd so they can't
    // disagree about which `columns` value matters.
    const stream = process.stderr;
    const isEnabled = isSpinnerInteractive(stream);
    const instance = ora({ text, indent: SPINNER_INDENT_CHARS, isEnabled, stream });
    if (isEnabled) instance.start();

    let didFinalize = false;
    return {
      update(displayText: string) {
        if (didFinalize) return;
        instance.text = displayText;
      },
      succeed(displayText: string) {
        if (didFinalize) return;
        didFinalize = true;
        instance.succeed(displayText);
      },
      fail(displayText: string) {
        if (didFinalize) return;
        didFinalize = true;
        instance.fail(displayText);
      },
    };
  },
});
