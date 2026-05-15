import type { ReactDoctorConfig } from "@react-doctor/types";
import type { InspectFlags } from "./inspect-flags.js";
import { coerceDiffValue } from "./coerce-diff-value.js";

export const resolveEffectiveDiff = (
  flags: InspectFlags,
  userConfig: ReactDoctorConfig | null,
): boolean | string | undefined => {
  // HACK: --full is the documented "always run a full scan" escape hatch.
  // It must override config-set `diff: true` / `diff: "main"`, otherwise
  // the flag is silently ignored when a project's react-doctor.config.json
  // has any diff value.
  if (flags.full) return false;
  return coerceDiffValue(flags.diff ?? userConfig?.diff);
};
