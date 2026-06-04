import pc from "picocolors";

export const highlighter = {
  error: pc.red,
  warn: pc.yellow,
  info: pc.cyan,
  success: pc.green,
  dim: pc.dim,
  gray: pc.gray,
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
  highlighter.bold = colors.bold;
};
