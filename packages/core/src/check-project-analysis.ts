import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAINTAINABILITY_CATEGORY,
  MAINTAINABILITY_PLUGIN,
  PROJECT_ANALYSIS_WORKER_MAX_OLD_SPACE_MB,
  PROJECT_ANALYSIS_WORKER_TIMEOUT_MS,
  TSCONFIG_FILENAMES,
} from "./constants.js";
import { withProjectAnalysisWorkerSlot } from "./project-analysis/project-analysis-worker-slots.js";
import type { Diagnostic } from "./types/index.js";
import { isRecord } from "./utils/is-record.js";
import { toCanonicalPath } from "./utils/to-canonical-path.js";
import { toRelativePath } from "./utils/to-relative-path.js";

export interface ProjectAnalysisWorkerHandle {
  readonly result: Promise<unknown>;
  readonly terminate?: () => void | Promise<unknown>;
}

export interface ProjectAnalysisWorkerInput {
  readonly rootDirectory: string;
  readonly tsConfigPath?: string;
  readonly ignorePatterns?: ReadonlyArray<string>;
}

export interface CheckProjectAnalysisOptions {
  readonly rootDirectory: string;
  readonly enabledRuleIds: ReadonlySet<string>;
  readonly abortSignal?: AbortSignal;
  readonly excludedProjectDirectories?: ReadonlyArray<string>;
  readonly ignorePatterns?: ReadonlyArray<string>;
  readonly workerTimeoutMs?: number;
  readonly createWorker?: (input: ProjectAnalysisWorkerInput) => ProjectAnalysisWorkerHandle;
}

interface ProjectAnalysisUnusedFile {
  readonly path: string;
}

interface ProjectAnalysisUnusedExport {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly column: number;
  readonly isTypeOnly: boolean;
}

interface ProjectAnalysisUnusedDependency {
  readonly name: string;
  readonly isDevDependency: boolean;
}

interface ProjectAnalysisCircularDependency {
  readonly files: ReadonlyArray<string>;
}

interface ProjectAnalysisError {
  readonly code: string;
  readonly module: string;
  readonly severity: "fatal" | "warning" | "info";
  readonly message: string;
}

interface ProjectAnalysisResult {
  readonly unusedFiles: ReadonlyArray<ProjectAnalysisUnusedFile>;
  readonly unusedExports: ReadonlyArray<ProjectAnalysisUnusedExport>;
  readonly unusedDependencies: ReadonlyArray<ProjectAnalysisUnusedDependency>;
  readonly circularDependencies: ReadonlyArray<ProjectAnalysisCircularDependency>;
  readonly analysisErrors: ReadonlyArray<ProjectAnalysisError>;
}

interface SerializedProjectAnalysisError {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}

interface ProjectAnalysisWorkerSuccess {
  readonly ok: true;
  readonly result: unknown;
}

interface ProjectAnalysisWorkerFailure {
  readonly ok: false;
  readonly error: SerializedProjectAnalysisError;
}

const REACT_DOCTOR_TOOLCHAIN_PACKAGES: ReadonlySet<string> = new Set([
  "react-doctor",
  "eslint-plugin-react-doctor",
  "oxlint-plugin-react-doctor",
]);

const parseArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`Project analysis returned invalid ${label}.`);
  return value;
};

const parseString = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new Error(`Project analysis returned invalid ${label}.`);
  return value;
};

const parseNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number") throw new Error(`Project analysis returned invalid ${label}.`);
  return value;
};

const parseBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`Project analysis returned invalid ${label}.`);
  return value;
};

const parseUnusedFiles = (value: unknown): ProjectAnalysisUnusedFile[] =>
  parseArray(value, "unusedFiles").map((entry, index) => {
    if (!isRecord(entry))
      throw new Error(`Project analysis returned invalid unusedFiles[${index}].`);
    return { path: parseString(entry.path, `unusedFiles[${index}].path`) };
  });

const parseUnusedExports = (value: unknown): ProjectAnalysisUnusedExport[] =>
  parseArray(value, "unusedExports").map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Project analysis returned invalid unusedExports[${index}].`);
    }
    return {
      path: parseString(entry.path, `unusedExports[${index}].path`),
      name: parseString(entry.name, `unusedExports[${index}].name`),
      line: parseNumber(entry.line, `unusedExports[${index}].line`),
      column: parseNumber(entry.column, `unusedExports[${index}].column`),
      isTypeOnly: parseBoolean(entry.isTypeOnly, `unusedExports[${index}].isTypeOnly`),
    };
  });

const parseUnusedDependencies = (value: unknown): ProjectAnalysisUnusedDependency[] =>
  parseArray(value, "unusedDependencies").map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Project analysis returned invalid unusedDependencies[${index}].`);
    }
    return {
      name: parseString(entry.name, `unusedDependencies[${index}].name`),
      isDevDependency: parseBoolean(
        entry.isDevDependency,
        `unusedDependencies[${index}].isDevDependency`,
      ),
    };
  });

const parseCircularDependencies = (value: unknown): ProjectAnalysisCircularDependency[] =>
  parseArray(value, "circularDependencies").map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Project analysis returned invalid circularDependencies[${index}].`);
    }
    return {
      files: parseArray(entry.files, `circularDependencies[${index}].files`).map(
        (filePath, fileIndex) =>
          parseString(filePath, `circularDependencies[${index}].files[${fileIndex}]`),
      ),
    };
  });

const parseAnalysisErrors = (value: unknown): ProjectAnalysisError[] =>
  parseArray(value, "analysisErrors").map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Project analysis returned invalid analysisErrors[${index}].`);
    }
    const severity = parseString(entry.severity, `analysisErrors[${index}].severity`);
    if (severity !== "fatal" && severity !== "warning" && severity !== "info") {
      throw new Error(`Project analysis returned invalid analysisErrors[${index}].severity.`);
    }
    return {
      code: parseString(entry.code, `analysisErrors[${index}].code`),
      module: parseString(entry.module, `analysisErrors[${index}].module`),
      severity,
      message: parseString(entry.message, `analysisErrors[${index}].message`),
    };
  });

const parseProjectAnalysisResult = (value: unknown): ProjectAnalysisResult => {
  if (!isRecord(value)) throw new Error("Project analysis returned an invalid result.");
  return {
    unusedFiles: parseUnusedFiles(value.unusedFiles),
    unusedExports: parseUnusedExports(value.unusedExports),
    unusedDependencies: parseUnusedDependencies(value.unusedDependencies),
    circularDependencies: parseCircularDependencies(value.circularDependencies),
    analysisErrors: parseAnalysisErrors(value.analysisErrors),
  };
};

const parseWorkerMessage = (
  value: unknown,
): ProjectAnalysisWorkerSuccess | ProjectAnalysisWorkerFailure => {
  if (!isRecord(value)) throw new Error("Project analysis worker returned an invalid message.");
  if (value.ok === true) return { ok: true, result: value.result };
  if (value.ok !== false || !isRecord(value.error) || typeof value.error.message !== "string") {
    throw new Error("Project analysis worker returned an invalid status.");
  }
  return {
    ok: false,
    error: {
      message: value.error.message,
      ...(typeof value.error.name === "string" ? { name: value.error.name } : {}),
      ...(typeof value.error.stack === "string" ? { stack: value.error.stack } : {}),
    },
  };
};

const buildWorkerError = (serializedError: SerializedProjectAnalysisError): Error => {
  const error = new Error(serializedError.message);
  if (serializedError.name !== undefined) error.name = serializedError.name;
  if (serializedError.stack !== undefined) error.stack = serializedError.stack;
  return error;
};

const createProjectAnalysisWorker = (
  input: ProjectAnalysisWorkerInput,
): ProjectAnalysisWorkerHandle => {
  const workerPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "project-analysis-worker.js",
  );
  const child = spawn(
    process.execPath,
    [`--max-old-space-size=${PROJECT_ANALYSIS_WORKER_MAX_OLD_SPACE_MB}`, workerPath],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  let didSettle = false;
  const result = new Promise<unknown>((resolve, reject) => {
    const settle = (complete: () => void): void => {
      if (didSettle) return;
      didSettle = true;
      complete();
    };
    child.once("error", (error) => settle(() => reject(error)));
    child.once("close", (exitCode) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      if (stdout.length === 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        settle(() =>
          reject(
            new Error(
              `Project analysis worker exited with code ${exitCode ?? "null"}${
                stderr.length > 0 ? `: ${stderr}` : ""
              }.`,
            ),
          ),
        );
        return;
      }
      try {
        const message = parseWorkerMessage(JSON.parse(stdout));
        settle(() =>
          message.ok ? resolve(message.result) : reject(buildWorkerError(message.error)),
        );
      } catch (error) {
        settle(() => reject(error));
      }
    });
  });
  const ignoreClosedWorkerInput = (): void => undefined;
  child.stdin.on("error", ignoreClosedWorkerInput);
  child.stdin.end(JSON.stringify(input));
  return {
    result,
    terminate: () => {
      didSettle = true;
      child.kill("SIGKILL");
    },
  };
};

const runWorker = async (
  workerHandle: ProjectAnalysisWorkerHandle,
  abortSignal?: AbortSignal,
  timeoutMs = PROJECT_ANALYSIS_WORKER_TIMEOUT_MS,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let didSettle = false;
    const settle = (complete: () => void): void => {
      if (didSettle) return;
      didSettle = true;
      clearTimeout(timeoutHandle);
      abortSignal?.removeEventListener("abort", onAbort);
      void workerHandle.terminate?.();
      complete();
    };
    const onAbort = (): void => settle(() => reject(new Error("Project analysis was cancelled.")));
    const timeoutHandle = setTimeout(
      () => settle(() => reject(new Error("Project analysis worker timed out."))),
      timeoutMs,
    );
    timeoutHandle.unref();
    if (abortSignal?.aborted) {
      onAbort();
      return;
    }
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    workerHandle.result.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });

const resolveTsConfigPath = (rootDirectory: string): string | undefined => {
  for (const filename of TSCONFIG_FILENAMES) {
    const candidatePath = path.join(rootDirectory, filename);
    if (fs.existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
};

const toRelativeFilePath = (rootDirectory: string, filePath: string): string => {
  const relativePath = toRelativePath(filePath, rootDirectory);
  return relativePath.length > 0 ? relativePath : filePath.replaceAll("\\", "/");
};

const buildDiagnostics = (
  rootDirectory: string,
  result: ProjectAnalysisResult,
  enabledRuleIds: ReadonlySet<string>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const toRelative = (filePath: string): string => toRelativeFilePath(rootDirectory, filePath);
  if (enabledRuleIds.has("unused-file")) {
    for (const unusedFile of result.unusedFiles) {
      diagnostics.push({
        filePath: toRelative(unusedFile.path),
        plugin: MAINTAINABILITY_PLUGIN,
        rule: "unused-file",
        severity: "warning",
        title: "Source file is unreachable",
        message: "No discovered application, package, or framework entry point reaches this file.",
        help: "Delete the file if it is obsolete, or import or register it from the correct entry path.",
        line: 0,
        column: 0,
        category: MAINTAINABILITY_CATEGORY,
      });
    }
  }
  for (const unusedExport of result.unusedExports) {
    const ruleId = unusedExport.isTypeOnly ? "unused-type" : "unused-export";
    if (!enabledRuleIds.has(ruleId)) continue;
    const exportKind = unusedExport.isTypeOnly ? "type export" : "value export";
    diagnostics.push({
      filePath: toRelative(unusedExport.path),
      plugin: MAINTAINABILITY_PLUGIN,
      rule: ruleId,
      severity: "warning",
      title: unusedExport.isTypeOnly
        ? "Type export has no importer"
        : "Value export has no importer",
      message: `Unused ${exportKind}: \`${unusedExport.name}\` has no importer in the analyzed project graph.`,
      help: "Remove the export or make it module-private after checking external, generated, and dynamic consumers.",
      line: unusedExport.line,
      column: unusedExport.column,
      category: MAINTAINABILITY_CATEGORY,
    });
  }
  for (const unusedDependency of result.unusedDependencies) {
    if (REACT_DOCTOR_TOOLCHAIN_PACKAGES.has(unusedDependency.name)) continue;
    const ruleId = unusedDependency.isDevDependency ? "unused-dev-dependency" : "unused-dependency";
    if (!enabledRuleIds.has(ruleId)) continue;
    const dependencyKind = unusedDependency.isDevDependency ? "devDependency" : "dependency";
    diagnostics.push({
      filePath: "package.json",
      plugin: MAINTAINABILITY_PLUGIN,
      rule: ruleId,
      severity: "warning",
      title: unusedDependency.isDevDependency
        ? "Development dependency has no discovered use"
        : "Dependency has no discovered use",
      message: `Unused ${dependencyKind}: \`${unusedDependency.name}\``,
      help: `Remove this ${dependencyKind} after checking source, scripts, configuration, CI, and generated consumers.`,
      line: 0,
      column: 0,
      category: MAINTAINABILITY_CATEGORY,
    });
  }
  if (enabledRuleIds.has("circular-dependency")) {
    for (const cycle of result.circularDependencies) {
      if (cycle.files.length === 0) continue;
      diagnostics.push({
        filePath: toRelative(cycle.files[0]),
        plugin: MAINTAINABILITY_PLUGIN,
        rule: "circular-dependency",
        severity: "warning",
        title: "Runtime import cycle",
        message: `Runtime import cycle: ${cycle.files.map(toRelative).join(" → ")}. Modules in the cycle can observe partially initialized exports.`,
        help: "Break the cycle by extracting shared code into a lower-level module or inverting one dependency.",
        line: 0,
        column: 0,
        category: MAINTAINABILITY_CATEGORY,
      });
    }
  }
  return diagnostics;
};

const assertCompleteProjectAnalysis = (result: ProjectAnalysisResult): void => {
  const fatalErrors = result.analysisErrors.filter((error) => error.severity === "fatal");
  if (fatalErrors.length === 0) return;
  const firstError = fatalErrors[0];
  throw new Error(
    `Project analysis was incomplete (${fatalErrors.length} fatal issue${fatalErrors.length === 1 ? "" : "s"}): ${firstError.code}: ${firstError.message}`,
  );
};

export const checkProjectAnalysis = async (
  options: CheckProjectAnalysisOptions,
): Promise<Diagnostic[]> => {
  if (options.enabledRuleIds.size === 0) return [];
  const rootDirectory = toCanonicalPath(options.rootDirectory);
  if (!fs.existsSync(path.join(rootDirectory, "package.json"))) return [];
  const tsConfigPath = resolveTsConfigPath(rootDirectory);
  const ignorePatterns = [
    ...(options.ignorePatterns ?? []),
    ...(options.excludedProjectDirectories ?? []).map(
      (directory) => `${toRelativeFilePath(rootDirectory, toCanonicalPath(directory))}/**`,
    ),
  ];
  const workerInput: ProjectAnalysisWorkerInput = {
    rootDirectory,
    ...(tsConfigPath === undefined ? {} : { tsConfigPath }),
    ...(ignorePatterns.length === 0 ? {} : { ignorePatterns }),
  };
  const spawnAndRunWorker = async (): Promise<unknown> => {
    const workerHandle = (options.createWorker ?? createProjectAnalysisWorker)(workerInput);
    return runWorker(workerHandle, options.abortSignal, options.workerTimeoutMs);
  };
  const rawResult =
    options.createWorker === undefined
      ? await withProjectAnalysisWorkerSlot(spawnAndRunWorker, options.abortSignal)
      : await spawnAndRunWorker();
  const result = parseProjectAnalysisResult(rawResult);
  assertCompleteProjectAnalysis(result);
  return buildDiagnostics(rootDirectory, result, options.enabledRuleIds);
};
