import type { CheckSecurityScanOptions } from "../../check-security-scan.js";
import type { Diagnostic } from "../../types/index.js";
import { isRecord } from "../../utils/is-record.js";

export interface SecurityScanWorkerOptions extends Omit<
  CheckSecurityScanOptions,
  "signal" | "onDeadlineExceeded" | "ignoredTags" | "includedTags" | "excludedDirectories"
> {
  readonly ignoredTags?: string[];
  readonly includedTags?: string[];
  readonly excludedDirectories?: string[];
}

export interface SecurityScanWorkerRequest {
  readonly type: "scan";
  readonly id: number;
  readonly rootDirectory: string;
  readonly options: SecurityScanWorkerOptions;
}

export interface SecurityScanWorkerAbort {
  readonly type: "abort";
  readonly id: number;
}

export interface SecurityScanWorkerError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export interface SecurityScanWorkerSuccess {
  readonly type: "result";
  readonly id: number;
  readonly ok: true;
  readonly diagnostics: Diagnostic[];
  readonly didReachDeadline: boolean;
}

export interface SecurityScanWorkerFailure {
  readonly type: "result";
  readonly id: number;
  readonly ok: false;
  readonly error: SecurityScanWorkerError;
  readonly didReachDeadline: boolean;
}

const isWorkerOptions = (value: unknown): value is SecurityScanWorkerOptions =>
  isRecord(value) &&
  Object.keys(value).every((name) =>
    [
      "project",
      "ignoredTags",
      "includedTags",
      "excludedDirectories",
      "includeTagDefaults",
      "deadlineEpochMs",
    ].includes(name),
  ) &&
  (value.project === undefined || isRecord(value.project)) &&
  [value.ignoredTags, value.includedTags, value.excludedDirectories].every(
    (entries) =>
      entries === undefined ||
      (Array.isArray(entries) && entries.every((entry) => typeof entry === "string")),
  ) &&
  (value.includeTagDefaults === undefined || typeof value.includeTagDefaults === "boolean") &&
  (value.deadlineEpochMs === undefined || typeof value.deadlineEpochMs === "number");

const isRawSecurityDiagnostic = (value: unknown): value is Diagnostic =>
  isRecord(value) &&
  Object.getOwnPropertySymbols(value).length === 0 &&
  Object.keys(value).every((name) =>
    [
      "filePath",
      "plugin",
      "rule",
      "severity",
      "title",
      "message",
      "help",
      "line",
      "column",
      "category",
    ].includes(name),
  ) &&
  typeof value.filePath === "string" &&
  value.plugin === "react-doctor" &&
  typeof value.rule === "string" &&
  (value.severity === "error" || value.severity === "warning") &&
  typeof value.title === "string" &&
  typeof value.message === "string" &&
  typeof value.help === "string" &&
  typeof value.line === "number" &&
  Number.isFinite(value.line) &&
  typeof value.column === "number" &&
  Number.isFinite(value.column) &&
  value.category === "Security";

export const encodeSecurityScanWorkerOptions = (
  options: CheckSecurityScanOptions,
): SecurityScanWorkerOptions =>
  structuredClone({
    project: options.project,
    ignoredTags: options.ignoredTags === undefined ? undefined : [...options.ignoredTags],
    includedTags: options.includedTags === undefined ? undefined : [...options.includedTags],
    excludedDirectories:
      options.excludedDirectories === undefined ? undefined : [...options.excludedDirectories],
    includeTagDefaults: options.includeTagDefaults,
    deadlineEpochMs: options.deadlineEpochMs,
  });

export const decodeSecurityScanWorkerOptions = (
  options: SecurityScanWorkerOptions,
): CheckSecurityScanOptions => ({
  ...options,
  ignoredTags: options.ignoredTags === undefined ? undefined : new Set(options.ignoredTags),
  includedTags: options.includedTags === undefined ? undefined : new Set(options.includedTags),
  excludedDirectories:
    options.excludedDirectories === undefined ? undefined : new Set(options.excludedDirectories),
});

export const parseSecurityScanWorkerRequest = (
  value: unknown,
): SecurityScanWorkerRequest | SecurityScanWorkerAbort => {
  if (isRecord(value)) {
    if (Number.isSafeInteger(value.id) && typeof value.id === "number" && value.id > 0) {
      if (value.type === "abort") return { type: "abort", id: value.id };
      if (
        value.type === "scan" &&
        typeof value.rootDirectory === "string" &&
        isWorkerOptions(value.options)
      ) {
        return {
          type: "scan",
          id: value.id,
          rootDirectory: value.rootDirectory,
          options: value.options,
        };
      }
    }
  }
  throw new Error("Security scan worker received an invalid request.");
};

export const parseSecurityScanWorkerResult = (
  value: unknown,
): SecurityScanWorkerSuccess | SecurityScanWorkerFailure => {
  if (
    isRecord(value) &&
    value.type === "result" &&
    typeof value.id === "number" &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    typeof value.didReachDeadline === "boolean"
  ) {
    if (
      value.ok === true &&
      Array.isArray(value.diagnostics) &&
      value.diagnostics.every(isRawSecurityDiagnostic)
    ) {
      return {
        type: "result",
        id: value.id,
        ok: true,
        diagnostics: value.diagnostics,
        didReachDeadline: value.didReachDeadline,
      };
    }
    if (
      value.ok === false &&
      isRecord(value.error) &&
      typeof value.error.name === "string" &&
      typeof value.error.message === "string" &&
      (value.error.stack === undefined || typeof value.error.stack === "string")
    ) {
      return {
        type: "result",
        id: value.id,
        ok: false,
        error: { name: value.error.name, message: value.error.message, stack: value.error.stack },
        didReachDeadline: value.didReachDeadline,
      };
    }
  }
  throw new Error("Security scan worker returned an invalid result.");
};
