import type { ReactDoctorConfig } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import type { InspectFlags } from "./inspect-flags.js";

// `--fail-on` / `failOn` were renamed to `--blocking` / `blocking` (same
// `error | warning | none` values + `error` default). The old name is honored
// as an alias only when the new one is unset, so warn once so users migrate.
// Routed through cliLogger so it's suppressed in JSON / silent mode like every
// CLI warning.
export const warnDeprecatedFailOn = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): void => {
  const usedFlag = flags.failOn !== undefined;
  const usedConfig = userConfig?.failOn !== undefined;
  if (!usedFlag && !usedConfig) return;
  const source = usedFlag ? "The `--fail-on` flag" : "The `failOn` config option";
  const replacement = usedFlag ? "`--blocking <level>`" : "`blocking`";
  logger.warn(`${source} is deprecated; rename it to ${replacement}.`);
};
