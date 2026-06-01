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
  if (flags.yes && flags.full) {
    throw new CliInputError("Cannot combine --yes and --full; pick one.");
  }
  if (flags.score && flags.json) {
    throw new CliInputError("Cannot combine --score and --json; pick one output mode.");
  }
  if (flags.score && flags.telemetry === false) {
    throw new CliInputError(
      "Cannot combine --score with --no-telemetry; --score prints the score that --no-telemetry disables.",
    );
  }
  if (flags.prComment && (flags.json || flags.score)) {
    throw new CliInputError("--pr-comment cannot be combined with --json or --score.");
  }
  if (flags.annotations && flags.score) {
    throw new CliInputError("--annotations cannot be combined with --score.");
  }
  if (flags.explain !== undefined && flags.why !== undefined) {
    throw new CliInputError("Use --explain or --why, not both — they're aliases of the same flag.");
  }
  const explainArgument = flags.explain ?? flags.why;
  if (
    explainArgument !== undefined &&
    (flags.json || flags.score || flags.annotations || flags.staged)
  ) {
    throw new CliInputError(
      "--explain cannot be combined with --json, --score, --annotations, or --staged.",
    );
  }
};
