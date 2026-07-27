import { isScanComplete } from "../../core/core-reporting.js";
import type { InspectResult } from "../../core/core-types.js";

export const isInspectResultComplete = (result: InspectResult): boolean =>
  isScanComplete({
    analyzedFileCount: result.analyzedFiles?.length,
    scannedFileCount: result.scannedFileCount,
    skippedCheckCount: result.skippedChecks.length,
    skippedCheckReasonCount: Object.keys(result.skippedCheckReasons ?? {}).length,
  });
