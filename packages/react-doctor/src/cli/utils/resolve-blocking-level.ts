import type { BlockingLevel, ReactDoctorConfig } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import type { InspectFlags } from "./inspect-flags.js";

const VALID_BLOCKING_LEVELS = new Set<BlockingLevel>(["error", "warning", "none"]);
// react-doctor blocks CI on `"error"`-severity diagnostics by default. Opt into
// a stricter gate with `--blocking warning` or disable it with `none`
// (advisory). `--blocking` (or `blocking` in config) wins over the deprecated
// `--fail-on` / `failOn` alias; flags win over config.
const DEFAULT_BLOCKING_LEVEL: BlockingLevel = "error";

export const isValidBlockingLevel = (level: string): level is BlockingLevel =>
  VALID_BLOCKING_LEVELS.has(level as BlockingLevel);

// The configured blocking level before validation/defaulting (flag wins over
// config; the new name wins over the deprecated `failOn` alias). `undefined`
// when nothing is set. Single source of the precedence chain, shared with the
// warning-gate derivation in `resolve-cli-inspect-options`.
export const pickBlockingLevel = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): string | undefined =>
  flags.blocking ?? flags.failOn ?? userConfig?.blocking ?? userConfig?.failOn;

export const resolveBlockingLevel = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): BlockingLevel => {
  const sourceValue = pickBlockingLevel(flags, userConfig) ?? DEFAULT_BLOCKING_LEVEL;
  if (isValidBlockingLevel(sourceValue)) return sourceValue;
  // An invalid level resolves to the default rather than guessing a looser or
  // stricter gate the user didn't ask for, and warns.
  logger.warn(
    `Invalid blocking level "${sourceValue}". Expected one of: error, warning, none. Falling back to "${DEFAULT_BLOCKING_LEVEL}".`,
  );
  return DEFAULT_BLOCKING_LEVEL;
};
