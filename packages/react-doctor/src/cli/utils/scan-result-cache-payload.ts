import * as Schema from "effect/Schema";
import { Diagnostic as DiagnosticSchema } from "@react-doctor/core/schemas";
import type {
  Diagnostic,
  InspectOutput,
  InspectResult,
  ReactDoctorConfig,
  ScoreResult,
  SuppressedRuleCount,
} from "@react-doctor/core";
import { isRecord } from "./git-hook-shared.js";

export interface CachedScanPayload {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly project: InspectResult["project"];
  readonly userConfig: ReactDoctorConfig | null;
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  readonly lintPartialFailures: ReadonlyArray<string>;
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
  readonly deadCodeOverlapped: boolean;
  readonly directory: string;
  readonly scannedFileCount: number;
  readonly scannedFilePaths: ReadonlyArray<string>;
  readonly analyzedFiles?: ReadonlyArray<string>;
  readonly scanElapsedMilliseconds: number;
  readonly baselineDelta: InspectResult["baselineDelta"];
  readonly lintFailureReasonKind: InspectOutput["lintFailureReasonKind"];
  readonly scanConcurrency?: number;
  readonly supplyChainOverlapTimedOut: boolean;
  readonly securityScanFailed?: boolean;
  readonly securityScanFailureReason?: string | null;
  readonly suppressedRuleCounts?: ReadonlyArray<SuppressedRuleCount>;
  readonly manifestContentHash?: string | null;
}

interface CachedScanPayloadFieldValidator {
  readonly key: keyof CachedScanPayload;
  readonly isValid: (value: unknown) => boolean;
}

const decodeDiagnostic = Schema.decodeUnknownSync(DiagnosticSchema);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isNumber = (value: unknown): value is number => typeof value === "number";

const isString = (value: unknown): value is string => typeof value === "string";

const isDiagnosticArray = (value: unknown): value is Diagnostic[] => {
  if (!Array.isArray(value)) return false;
  try {
    for (const entry of value) decodeDiagnostic(entry);
    return true;
  } catch {
    return false;
  }
};

const isScoreResult = (value: unknown): value is ScoreResult | null =>
  value === null ||
  (isRecord(value) && typeof value.score === "number" && typeof value.label === "string");

const isProjectInfo = (value: unknown): value is InspectResult["project"] =>
  isRecord(value) &&
  typeof value.rootDirectory === "string" &&
  typeof value.projectName === "string" &&
  typeof value.framework === "string" &&
  typeof value.sourceFileCount === "number";

const isBaselineDelta = (value: unknown): value is NonNullable<InspectResult["baselineDelta"]> =>
  isRecord(value) &&
  typeof value.baseRef === "string" &&
  typeof value.fixedCount === "number" &&
  typeof value.baseTotalCount === "number" &&
  (value.crossFileMatchCount === undefined || typeof value.crossFileMatchCount === "number");

const isSuppressedRuleCountArray = (value: unknown): value is SuppressedRuleCount[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.rule === "string" &&
      typeof entry.source === "string" &&
      typeof entry.count === "number",
  );

const REQUIRED_CACHED_SCAN_PAYLOAD_FIELDS: ReadonlyArray<CachedScanPayloadFieldValidator> = [
  { key: "diagnostics", isValid: isDiagnosticArray },
  { key: "score", isValid: isScoreResult },
  { key: "project", isValid: isProjectInfo },
  { key: "userConfig", isValid: (value) => value === null || isRecord(value) },
  { key: "didLintFail", isValid: isBoolean },
  { key: "lintFailureReason", isValid: isNullableString },
  { key: "lintPartialFailures", isValid: isStringArray },
  { key: "didDeadCodeFail", isValid: isBoolean },
  { key: "deadCodeFailureReason", isValid: isNullableString },
  { key: "deadCodeOverlapped", isValid: isBoolean },
  { key: "directory", isValid: isString },
  { key: "scannedFileCount", isValid: isNumber },
  { key: "scannedFilePaths", isValid: isStringArray },
  { key: "scanElapsedMilliseconds", isValid: isNumber },
  { key: "lintFailureReasonKind", isValid: isNullableString },
  { key: "supplyChainOverlapTimedOut", isValid: isBoolean },
];

const OPTIONAL_CACHED_SCAN_PAYLOAD_FIELDS: ReadonlyArray<CachedScanPayloadFieldValidator> = [
  { key: "analyzedFiles", isValid: isStringArray },
  { key: "baselineDelta", isValid: isBaselineDelta },
  { key: "scanConcurrency", isValid: isNumber },
  { key: "securityScanFailed", isValid: isBoolean },
  { key: "securityScanFailureReason", isValid: isNullableString },
  { key: "suppressedRuleCounts", isValid: isSuppressedRuleCountArray },
  { key: "manifestContentHash", isValid: isNullableString },
];

const hasValidRequiredCachedScanPayloadFields = (value: Record<string, unknown>): boolean =>
  REQUIRED_CACHED_SCAN_PAYLOAD_FIELDS.every((field) => field.isValid(value[field.key]));

const hasValidOptionalCachedScanPayloadFields = (value: Record<string, unknown>): boolean =>
  OPTIONAL_CACHED_SCAN_PAYLOAD_FIELDS.every(
    (field) => value[field.key] === undefined || field.isValid(value[field.key]),
  );

const isCachedScanPayload = (value: unknown): value is CachedScanPayload => {
  if (!isRecord(value)) return false;
  return (
    hasValidRequiredCachedScanPayloadFields(value) && hasValidOptionalCachedScanPayloadFields(value)
  );
};

export const decodeCachedScanPayload = (value: unknown): CachedScanPayload | null =>
  isCachedScanPayload(value) ? value : null;

export const shouldStoreScanPayload = (payload: CachedScanPayload): boolean =>
  !payload.didLintFail &&
  !payload.didDeadCodeFail &&
  payload.lintPartialFailures.length === 0 &&
  !payload.supplyChainOverlapTimedOut &&
  payload.securityScanFailed !== true;
