export type ProjectAnalysisErrorCode =
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

export type ProjectAnalysisErrorModule =
  | "collect"
  | "parse"
  | "linker"
  | "resolver"
  | "report"
  | "config";

export type ProjectAnalysisErrorSeverity = "fatal" | "warning" | "info";

export interface ProjectAnalysisErrorInput {
  code: ProjectAnalysisErrorCode;
  module: ProjectAnalysisErrorModule;
  message: string;
  severity?: ProjectAnalysisErrorSeverity;
  path?: string;
  detail?: string;
}

export interface ProjectAnalysisErrorFromCaughtInput extends Omit<
  ProjectAnalysisErrorInput,
  "detail"
> {
  caught: unknown;
}

export interface ProjectAnalysisErrorJson {
  name: string;
  code: ProjectAnalysisErrorCode;
  module: ProjectAnalysisErrorModule;
  severity: ProjectAnalysisErrorSeverity;
  message: string;
  path?: string;
  detail?: string;
}

import { MAX_ERROR_DETAIL_LENGTH } from "./constants.js";

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

export class ProjectAnalysisError extends Error {
  readonly code: ProjectAnalysisErrorCode;
  readonly module: ProjectAnalysisErrorModule;
  readonly severity: ProjectAnalysisErrorSeverity;
  readonly path?: string;
  readonly detail?: string;

  constructor(input: ProjectAnalysisErrorInput) {
    super(input.message);
    this.name = "ProjectAnalysisError";
    this.code = input.code;
    this.module = input.module;
    this.severity = input.severity ?? "warning";
    if (input.path !== undefined) this.path = input.path;
    if (input.detail !== undefined) this.detail = input.detail;
  }

  toJSON(): ProjectAnalysisErrorJson {
    const payload: ProjectAnalysisErrorJson = {
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

  static fromCaught(input: ProjectAnalysisErrorFromCaughtInput): ProjectAnalysisError {
    return new ProjectAnalysisError({
      code: input.code,
      module: input.module,
      severity: input.severity,
      message: input.message,
      path: input.path,
      detail: describeUnknownError(input.caught),
    });
  }
}

export class ConfigError extends ProjectAnalysisError {
  constructor(
    input: Omit<ProjectAnalysisErrorInput, "module" | "code"> & { code?: "config-invalid" },
  ) {
    super({
      ...input,
      code: input.code ?? "config-invalid",
      module: "config",
      severity: input.severity ?? "fatal",
    });
    this.name = "ConfigError";
  }
}

export class FileReadError extends ProjectAnalysisError {
  constructor(
    input: Omit<ProjectAnalysisErrorInput, "module" | "code"> & {
      code: "file-read-failed" | "file-too-large" | "file-empty" | "file-binary" | "file-minified";
    },
  ) {
    super({ ...input, module: "parse" });
    this.name = "FileReadError";
  }
}

export class ParseError extends ProjectAnalysisError {
  constructor(
    input: Omit<ProjectAnalysisErrorInput, "module" | "code"> & {
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

export class WorkspaceError extends ProjectAnalysisError {
  constructor(
    input: Omit<ProjectAnalysisErrorInput, "module" | "code"> & {
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

export class ResolverError extends ProjectAnalysisError {
  constructor(
    input: Omit<ProjectAnalysisErrorInput, "module" | "code"> & { code?: "resolver-init-failed" },
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

export class DetectorError extends ProjectAnalysisError {
  constructor(
    input: Omit<ProjectAnalysisErrorInput, "module" | "code"> & {
      module?: ProjectAnalysisErrorModule;
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
