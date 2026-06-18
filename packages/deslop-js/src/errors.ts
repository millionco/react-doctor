export type DeslopErrorCode =
  | "file-read-failed"
  | "file-too-large"
  | "file-empty"
  | "file-binary"
  | "file-minified"
  | "parse-failed"
  | "parse-recovered"
  | "parse-recovered-partial"
  | "ast-walk-failed"
  | "ast-walk-depth-exceeded"
  | "tsconfig-not-found"
  | "tsconfig-parse-failed"
  | "ts-program-creation-failed"
  | "ts-program-too-large"
  | "ts-not-loadable"
  | "package-json-not-found"
  | "package-json-parse-failed"
  | "workspace-discovery-failed"
  | "gitignore-check-failed"
  | "resolver-init-failed"
  | "monorepo-discovery-failed"
  | "detector-failed"
  | "config-invalid"
  | "system-out-of-memory"
  | "unknown";

export type DeslopErrorModule =
  | "collect"
  | "parse"
  | "linker"
  | "resolver"
  | "report"
  | "semantic"
  | "config";

export type DeslopErrorSeverity = "fatal" | "warning" | "info";

export interface DeslopErrorInput {
  code: DeslopErrorCode;
  module: DeslopErrorModule;
  message: string;
  severity?: DeslopErrorSeverity;
  path?: string;
  detail?: string;
}

export interface DeslopErrorFromCaughtInput extends Omit<DeslopErrorInput, "detail"> {
  caught: unknown;
}

export interface DeslopErrorJson {
  name: string;
  code: DeslopErrorCode;
  module: DeslopErrorModule;
  severity: DeslopErrorSeverity;
  message: string;
  path?: string;
  detail?: string;
}

import { MAX_ANALYSIS_ERRORS, MAX_ERROR_DETAIL_LENGTH } from "./constants.js";

const truncateDetail = (text: string): string => {
  if (text.length <= MAX_ERROR_DETAIL_LENGTH) return text;
  return `${text.slice(0, MAX_ERROR_DETAIL_LENGTH)}… [truncated ${text.length - MAX_ERROR_DETAIL_LENGTH} chars]`;
};

export const describeUnknownError = (caughtValue: unknown): string => {
  let rawText: string;
  if (caughtValue instanceof Error) {
    rawText = caughtValue.message || caughtValue.name || "unknown error";
  } else if (typeof caughtValue === "string") {
    rawText = caughtValue;
  } else {
    try {
      rawText = JSON.stringify(caughtValue);
    } catch {
      rawText = String(caughtValue);
    }
  }
  return truncateDetail(rawText ?? "");
};

export class DeslopError extends Error {
  readonly code: DeslopErrorCode;
  readonly module: DeslopErrorModule;
  readonly severity: DeslopErrorSeverity;
  readonly path?: string;
  readonly detail?: string;

  constructor(input: DeslopErrorInput) {
    super(input.message);
    this.name = "DeslopError";
    this.code = input.code;
    this.module = input.module;
    this.severity = input.severity ?? "warning";
    if (input.path !== undefined) this.path = input.path;
    if (input.detail !== undefined) this.detail = input.detail;
  }

  toJSON(): DeslopErrorJson {
    const payload: DeslopErrorJson = {
      name: this.name,
      code: this.code,
      module: this.module,
      severity: this.severity,
      message: this.message,
    };
    if (this.path !== undefined) payload.path = this.path;
    if (this.detail !== undefined) payload.detail = this.detail;
    return payload;
  }

  static fromCaught(input: DeslopErrorFromCaughtInput): DeslopError {
    return new DeslopError({
      code: input.code,
      module: input.module,
      severity: input.severity,
      message: input.message,
      path: input.path,
      detail: describeUnknownError(input.caught),
    });
  }
}

export class ConfigError extends DeslopError {
  constructor(input: Omit<DeslopErrorInput, "module" | "code"> & { code?: "config-invalid" }) {
    super({
      ...input,
      code: input.code ?? "config-invalid",
      module: "config",
      severity: input.severity ?? "fatal",
    });
    this.name = "ConfigError";
  }
}

export class FileReadError extends DeslopError {
  constructor(
    input: Omit<DeslopErrorInput, "module" | "code"> & {
      code: "file-read-failed" | "file-too-large" | "file-empty" | "file-binary" | "file-minified";
    },
  ) {
    super({ ...input, module: "parse" });
    this.name = "FileReadError";
  }
}

export class ParseError extends DeslopError {
  constructor(
    input: Omit<DeslopErrorInput, "module" | "code"> & {
      code:
        | "parse-failed"
        | "parse-recovered"
        | "parse-recovered-partial"
        | "ast-walk-failed"
        | "ast-walk-depth-exceeded";
    },
  ) {
    super({ ...input, module: "parse" });
    this.name = "ParseError";
  }
}

export class TypeScriptError extends DeslopError {
  constructor(
    input: Omit<DeslopErrorInput, "module" | "code"> & {
      code:
        | "tsconfig-not-found"
        | "tsconfig-parse-failed"
        | "ts-program-creation-failed"
        | "ts-program-too-large"
        | "ts-not-loadable";
    },
  ) {
    super({ ...input, module: "semantic" });
    this.name = "TypeScriptError";
  }
}

export class WorkspaceError extends DeslopError {
  constructor(
    input: Omit<DeslopErrorInput, "module" | "code"> & {
      code:
        | "workspace-discovery-failed"
        | "monorepo-discovery-failed"
        | "package-json-not-found"
        | "package-json-parse-failed"
        | "gitignore-check-failed";
    },
  ) {
    super({ ...input, module: "collect" });
    this.name = "WorkspaceError";
  }
}

export class ResolverError extends DeslopError {
  constructor(
    input: Omit<DeslopErrorInput, "module" | "code"> & { code?: "resolver-init-failed" },
  ) {
    super({
      ...input,
      code: input.code ?? "resolver-init-failed",
      module: "resolver",
      severity: input.severity ?? "fatal",
    });
    this.name = "ResolverError";
  }
}

export class DetectorError extends DeslopError {
  constructor(
    input: Omit<DeslopErrorInput, "module" | "code"> & {
      module?: DeslopErrorModule;
      code?: "detector-failed";
    },
  ) {
    super({
      ...input,
      code: input.code ?? "detector-failed",
      module: input.module ?? "report",
    });
    this.name = "DetectorError";
  }
}

export const createDeslopError = (input: DeslopErrorInput): DeslopError => new DeslopError(input);

export class DeslopErrorCollector {
  private readonly entries: DeslopError[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries: number = MAX_ANALYSIS_ERRORS) {
    this.maxEntries = maxEntries;
  }

  push(error: DeslopError): void {
    if (this.entries.length >= this.maxEntries) return;
    this.entries.push(error);
  }

  pushCaught(input: DeslopErrorFromCaughtInput): void {
    this.push(DeslopError.fromCaught(input));
  }

  snapshot(): DeslopError[] {
    return [...this.entries];
  }

  size(): number {
    return this.entries.length;
  }
}
