import { isScanComplete } from "@react-doctor/core";
import type { InspectResult } from "@react-doctor/core";

export const isInspectResultComplete = (result: InspectResult): boolean =>
  isScanComplete({
    analyzedFileCount: result.analyzedFiles?.length,
    scannedFileCount: result.scannedFileCount,
    skippedCheckCount: result.skippedChecks.length,
    skippedCheckReasonCount: Object.keys(result.skippedCheckReasons ?? {}).length,
  });
