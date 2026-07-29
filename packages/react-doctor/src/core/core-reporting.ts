import {
  buildJsonReport,
  buildJsonReportError,
  buildSkippedChecks,
  isScanComplete,
} from "@react-doctor/core";

export type {
  JsonReport,
  JsonReportDiagnosticV3,
  JsonReportDiffInfo,
  JsonReportError,
  JsonReportMode,
  JsonReportProjectEntry,
  JsonReportProjectEntryV3,
  JsonReportSummary,
  JsonReportV1,
  JsonReportV2,
  JsonReportV3,
} from "@react-doctor/core";
export type { Diagnostic as LiveDiagnostic } from "@react-doctor/core/schemas";

export { buildJsonReport, buildJsonReportError, buildSkippedChecks, isScanComplete };
