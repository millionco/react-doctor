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
  stop: () => {},
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
    // HACK: ora's `discardStdin` (default true on a TTY) puts stdin into
    // raw mode while spinning to swallow keystrokes — but raw mode also
    // stops the terminal from turning Ctrl-C into a SIGINT (it arrives as a
    // discarded 0x03 byte instead), so the scan becomes uncancellable. Opt
    // out so Ctrl-C keeps reaching the SIGINT handler in cli/index.ts.
    const instance = ora({
      text,
      indent: SPINNER_INDENT_CHARS,
      isEnabled,
      stream,
      discardStdin: false,
    });
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
      stop() {
        if (didFinalize) return;
        didFinalize = true;
        // `instance.stop()` clears the in-progress line in interactive
        // mode and is a no-op in the static (non-interactive) path, so
        // no persistent status line is left behind either way.
        instance.stop();
      },
    };
  },
});
