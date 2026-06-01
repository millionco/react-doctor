import { setColorEnabled } from "@react-doctor/core";

/**
 * Resolve an explicit color preference from `--color` / `--no-color` or the
 * app-specific `REACT_DOCTOR_NO_COLOR` / `REACT_DOCTOR_FORCE_COLOR` env vars
 * (clig.dev Output; 12-factor #6), overriding picocolors' own
 * `NO_COLOR` / `FORCE_COLOR` / `TERM` / TTY detection. Flags win over env
 * vars; with neither set, picocolors' detection stands.
 *
 * Scanning argv directly (not Commander's parsed options) applies the
 * preference once, before Commander parses, so it reaches every later path.
 * The scan stops at `--` so a trailing positional can't flip it.
 */
export const applyColorPreference = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): void => {
  let enabled: boolean | undefined;
  for (const argument of argv) {
    if (argument === "--") break;
    // Last flag wins, matching how most CLIs resolve conflicting toggles.
    if (argument === "--no-color") enabled = false;
    else if (argument === "--color") enabled = true;
  }

  if (enabled === undefined) {
    // Treat empty values as unset, matching the `NO_COLOR` convention.
    if (env.REACT_DOCTOR_NO_COLOR) enabled = false;
    else if (env.REACT_DOCTOR_FORCE_COLOR) enabled = true;
  }

  if (enabled !== undefined) setColorEnabled(enabled);
};
