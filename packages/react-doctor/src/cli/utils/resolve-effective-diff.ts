import type { ReactDoctorConfig } from "@react-doctor/core";
import type { InspectFlags } from "./inspect-flags.js";
import { coerceDiffValue } from "./coerce-diff-value.js";

export const resolveEffectiveDiff = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): boolean | string | undefined =>
  // `--diff false` is the "force a full scan" escape hatch: a set `flags.diff`
  // takes precedence over config, so `false` overrides a config-set
  // `diff: "main"` / `diff: true` and forces a full scan.
  coerceDiffValue(flags.diff ?? userConfig?.diff);
