import { MILLISECONDS_PER_SECOND } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";

// `--max-duration <seconds>` → milliseconds, or `undefined` when unset. An
// unparseable / non-positive value is ignored with a warning rather than
// silently gating the scan on a budget the user didn't intend.
export const resolveMaxDurationFlag = (maxDuration: string | undefined): number | undefined => {
  if (maxDuration === undefined) return undefined;
  const seconds = Number(maxDuration);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    logger.warn(
      `Invalid --max-duration "${maxDuration}". Expected a positive number of seconds; running without a budget.`,
    );
    return undefined;
  }
  return seconds * MILLISECONDS_PER_SECOND;
};
