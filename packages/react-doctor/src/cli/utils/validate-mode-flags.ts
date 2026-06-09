import { CliInputError } from "./cli-input-error.js";
import type { InspectFlags } from "./inspect-flags.js";
import { coerceDiffValue } from "./coerce-diff-value.js";

export const validateModeFlags = (flags: InspectFlags): void => {
  // HACK: use the same coercion as resolveEffectiveDiff so a bare
  // `--diff false` (or `--diff ""`) is treated as "no diff" and doesn't
  // trip the mutual-exclusion check against --staged.
  const coercedDiff = coerceDiffValue(flags.diff);
  const exclusiveModes = [
    flags.staged ? "--staged" : null,
    coercedDiff !== undefined && coercedDiff !== false ? "--diff" : null,
  ].filter((modeName): modeName is string => modeName !== null);

  if (exclusiveModes.length > 1) {
    throw new CliInputError(`Cannot combine ${exclusiveModes.join(" and ")}; pick one mode.`);
  }
  if (flags.score && flags.json) {
    throw new CliInputError("Cannot combine --score and --json; pick one output mode.");
  }
  if (flags.score && flags.telemetry === false) {
    throw new CliInputError(
      "Cannot combine --score with --no-telemetry; --score prints the score that --no-telemetry disables.",
    );
  }
  if (flags.sfw) {
    const conflictingFlag = [
      flags.json ? "--json" : null,
      flags.score ? "--score" : null,
      flags.staged ? "--staged" : null,
      coercedDiff !== undefined && coercedDiff !== false ? "--diff" : null,
    ].find((name): name is string => name !== null);
    if (conflictingFlag) {
      throw new CliInputError(
        `Cannot combine --sfw with ${conflictingFlag}; --sfw is a standalone demo listing.`,
      );
    }
  }
};
