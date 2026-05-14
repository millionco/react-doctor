import type { CliFlags } from "./cli-flags.js";
import { coerceDiffValue } from "./coerce-diff-value.js";

export const validateModeFlags = (flags: CliFlags): void => {
  // HACK: use the same coercion as resolveEffectiveDiff so a bare
  // `--diff false` (or `--diff ""`) is treated as "no diff" and doesn't
  // trip the mutual-exclusion check against --staged.
  const coercedDiff = coerceDiffValue(flags.diff);
  const exclusiveModes = [
    flags.staged ? "--staged" : null,
    coercedDiff !== undefined && coercedDiff !== false ? "--diff" : null,
  ].filter((modeName): modeName is string => modeName !== null);

  if (exclusiveModes.length > 1) {
    throw new Error(`Cannot combine ${exclusiveModes.join(" and ")}; pick one mode.`);
  }
  if (flags.yes && flags.full) {
    throw new Error("Cannot combine --yes and --full; pick one.");
  }
  if (flags.score && flags.json) {
    throw new Error("Cannot combine --score and --json; pick one output mode.");
  }
  if (flags.annotations && (flags.json || flags.score)) {
    throw new Error("--annotations cannot be combined with --json or --score.");
  }
  if (flags.explain !== undefined && flags.why !== undefined) {
    throw new Error("Use --explain or --why, not both — they're aliases of the same flag.");
  }
  const explainArgument = flags.explain ?? flags.why;
  if (
    explainArgument !== undefined &&
    (flags.json || flags.score || flags.annotations || flags.staged)
  ) {
    throw new Error(
      "--explain cannot be combined with --json, --score, --annotations, or --staged.",
    );
  }
};
