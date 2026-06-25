import pc from "picocolors";

// picocolors only ships the 16-color palette, so orange (Claude's brand) is a
// 256-color escape built by hand. Honors color-disabled by returning the input.
const ORANGE_ANSI_CODE = 208;
const makeOrange =
  (enabled: boolean): ((input: string | number) => string) =>
  (input) =>
    enabled ? `\u001b[38;5;${ORANGE_ANSI_CODE}m${input}\u001b[39m` : String(input);

export const highlighter = {
  error: pc.red,
  warn: pc.yellow,
  info: pc.cyan,
  success: pc.green,
  dim: pc.dim,
  gray: pc.gray,
  orange: makeOrange(pc.isColorSupported),
  bold: pc.bold,
};

/**
 * Override picocolors' automatic color detection. picocolors decides
 * once, at import time, from `NO_COLOR` / `FORCE_COLOR` / `TERM` / TTY.
 * This lets the CLI honor an explicit `--color` / `--no-color` flag
 * (clig.dev, Output: "Disable color … if the user requested it") by
 * swapping in a fresh set of formatters. Call it before any colored
 * output is produced. Every call site reads `highlighter.<method>` at
 * call time, so reassigning the properties propagates everywhere.
 */
export const setColorEnabled = (enabled: boolean): void => {
  const colors = pc.createColors(enabled);
  highlighter.error = colors.red;
  highlighter.warn = colors.yellow;
  highlighter.info = colors.cyan;
  highlighter.success = colors.green;
  highlighter.dim = colors.dim;
  highlighter.gray = colors.gray;
  highlighter.orange = makeOrange(enabled);
  highlighter.bold = colors.bold;
};
