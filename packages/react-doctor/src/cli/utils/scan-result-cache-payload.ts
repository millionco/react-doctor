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

const decodeDiagnostic = Schema.decodeUnknownSync(DiagnosticSchema);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

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

const isCachedScanPayload = (value: unknown): value is CachedScanPayload => {
  if (
    !isRecord(value) ||
    !isDiagnosticArray(value.diagnostics) ||
    !isScoreResult(value.score) ||
    !isProjectInfo(value.project) ||
    !(value.userConfig === null || isRecord(value.userConfig)) ||
    typeof value.didLintFail !== "boolean" ||
    !isNullableString(value.lintFailureReason) ||
    !isStringArray(value.lintPartialFailures) ||
    typeof value.didDeadCodeFail !== "boolean" ||
    !isNullableString(value.deadCodeFailureReason) ||
    typeof value.deadCodeOverlapped !== "boolean" ||
    typeof value.directory !== "string" ||
    typeof value.scannedFileCount !== "number" ||
    !isStringArray(value.scannedFilePaths) ||
    (value.analyzedFiles !== undefined && !isStringArray(value.analyzedFiles)) ||
    typeof value.scanElapsedMilliseconds !== "number" ||
    (value.baselineDelta !== undefined && !isBaselineDelta(value.baselineDelta)) ||
    !(value.lintFailureReasonKind === null || typeof value.lintFailureReasonKind === "string") ||
    (value.scanConcurrency !== undefined && typeof value.scanConcurrency !== "number") ||
    typeof value.supplyChainOverlapTimedOut !== "boolean" ||
    (value.securityScanFailed !== undefined && typeof value.securityScanFailed !== "boolean") ||
    (value.securityScanFailureReason !== undefined &&
      !isNullableString(value.securityScanFailureReason)) ||
    (value.suppressedRuleCounts !== undefined &&
      !isSuppressedRuleCountArray(value.suppressedRuleCounts)) ||
    (value.manifestContentHash !== undefined && !isNullableString(value.manifestContentHash))
  ) {
    return false;
  }
  return true;
};

export const decodeCachedScanPayload = (value: unknown): CachedScanPayload | null =>
  isCachedScanPayload(value) ? value : null;

export const shouldStoreScanPayload = (payload: CachedScanPayload): boolean =>
  !payload.didLintFail &&
  !payload.didDeadCodeFail &&
  payload.lintPartialFailures.length === 0 &&
  !payload.supplyChainOverlapTimedOut &&
  payload.securityScanFailed !== true;
