import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Diagnostic, ReactDoctorConfig } from "./types/index.js";
import {
  collectDeadCodeEntryPatterns,
  collectDeadCodeIgnorePatterns,
} from "./dead-code/collect-dead-code-patterns.js";
import {
  DEAD_CODE_WORKER_MAX_OLD_SPACE_MB,
  DEAD_CODE_WORKER_TIMEOUT_MS,
  MILLISECONDS_PER_SECOND,
  TSCONFIG_FILENAMES,
} from "./constants.js";
import { isRecord } from "./utils/is-record.js";
import { toCanonicalPath } from "./utils/to-canonical-path.js";
import { toRelativePath } from "./utils/to-relative-path.js";

// The plugin id and category every dead-code diagnostic carries.
// Centralized so severity-control checks (e.g. deciding whether to run
// the analysis at all when warnings are hidden) stay in sync with the
// diagnostics actually emitted below.
export const DEAD_CODE_PLUGIN = "deslop";
export const DEAD_CODE_CATEGORY = "Maintainability";

interface CheckDeadCodeOptions {
  readonly rootDirectory: string;
  /** Loaded react-doctor config — `ignore.files` is forwarded to deslop. */
  readonly userConfig?: ReactDoctorConfig | null;
  readonly deslopJsModuleSpecifier?: string;
  readonly createWorker?: DeadCodeWorkerFactory;
  readonly workerTimeoutMs?: number;
  /**
   * Caps deslop's internal parse worker pool (`DESLOP_PARSE_CONCURRENCY`). The
   * orchestrator sets this when dead-code overlaps lint so the two pools share
   * the cores instead of each claiming all of them — the oversubscription that
   * otherwise starves the parse pass past `workerTimeoutMs`. Omitted → deslop
   * uses `os.availableParallelism()` (the strictly-sequential / full-CPU path).
   */
  readonly parseConcurrency?: number;
  /**
   * Aborts the in-flight worker. The orchestrator threads
   * `Effect.tryPromise`'s signal here so interrupting the dead-code fiber
   * (e.g. when lint fails and dead-code becomes wasted work, or when the
   * scan is cancelled) SIGKILLs the 8 GB child PROCESS immediately via its
   * `terminate` handle instead of orphaning it until
   * `DEAD_CODE_WORKER_TIMEOUT_MS`.
   */
  readonly abortSignal?: AbortSignal;
}

interface DeadCodeWorkerInput {
  readonly rootDirectory: string;
  readonly entryPatterns: ReadonlyArray<string>;
  readonly tsConfigPath?: string;
  readonly ignorePatterns: ReadonlyArray<string>;
  readonly deslopJsModuleSpecifier: string;
  /** Caps deslop's parse pool via `DESLOP_PARSE_CONCURRENCY` on the child env. */
  readonly parseConcurrency?: number;
}

interface DeadCodeWorkerHandle {
  readonly result: Promise<unknown>;
  readonly terminate?: () => void | Promise<unknown>;
}

interface DeadCodeWorkerFactory {
  (input: DeadCodeWorkerInput): DeadCodeWorkerHandle;
}

interface DeadCodeWorkerUnusedFile {
  readonly path: string;
}

interface DeadCodeWorkerUnusedExport {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly column: number;
  readonly isTypeOnly: boolean;
}

interface DeadCodeWorkerUnusedDependency {
  readonly name: string;
  readonly isDevDependency: boolean;
}

interface DeadCodeWorkerCircularDependency {
  readonly files: ReadonlyArray<string>;
}

interface DeadCodeWorkerResult {
  readonly unusedFiles: ReadonlyArray<DeadCodeWorkerUnusedFile>;
  readonly unusedExports: ReadonlyArray<DeadCodeWorkerUnusedExport>;
  readonly unusedDependencies: ReadonlyArray<DeadCodeWorkerUnusedDependency>;
  readonly circularDependencies: ReadonlyArray<DeadCodeWorkerCircularDependency>;
}

interface DeadCodeWorkerError {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}

interface DeadCodeWorkerSuccessMessage {
  readonly ok: true;
  readonly result: unknown;
}

interface DeadCodeWorkerFailureMessage {
  readonly ok: false;
  readonly error: DeadCodeWorkerError;
}

// Runs in a child PROCESS (node -e), not a worker_thread — see
// `createDeadCodeWorker`. Reads the worker input as JSON on stdin and
// writes the normalized result (or a serialized error) as JSON on
// stdout, then exits once stdout has flushed.
const DEAD_CODE_WORKER_SCRIPT = `
const inputChunks = [];
process.stdin.on("data", (chunk) => inputChunks.push(chunk));
process.stdin.on("end", () => {
  const workerInput = JSON.parse(Buffer.concat(inputChunks).toString("utf8"));

  const normalizeResult = (result) => ({
    unusedFiles: result.unusedFiles.map((unusedFile) => ({
      path: unusedFile.path,
    })),
    unusedExports: result.unusedExports.map((unusedExport) => ({
      path: unusedExport.path,
      name: unusedExport.name,
      line: unusedExport.line,
      column: unusedExport.column,
      isTypeOnly: unusedExport.isTypeOnly,
    })),
    unusedDependencies: result.unusedDependencies.map((unusedDependency) => ({
      name: unusedDependency.name,
      isDevDependency: unusedDependency.isDevDependency,
    })),
    circularDependencies: result.circularDependencies.map((cycle) => ({
      files: cycle.files,
    })),
  });

  const serializeError = (error) =>
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) };

  const emit = (message) => {
    process.stdout.write(JSON.stringify(message), () => process.exit(0));
  };

  (async () => {
    try {
      const { analyze, defineConfig } = await import(workerInput.deslopJsModuleSpecifier);
      const config = {
        rootDir: workerInput.rootDirectory,
        ...(workerInput.entryPatterns.length > 0
          ? { entryPatterns: workerInput.entryPatterns }
          : {}),
        ...(workerInput.tsConfigPath ? { tsConfigPath: workerInput.tsConfigPath } : {}),
        ...(workerInput.ignorePatterns.length > 0
          ? { ignorePatterns: workerInput.ignorePatterns }
          : {}),
        // We consume only deslop's GRAPH-based findings (unusedFiles, unusedExports,
        // unusedDependencies, circularDependencies). Everything else deslop can compute
        // is pure wasted work for us, and it's the bulk of the runtime:
        //   - semantic: a full TS Program for unusedTypes/enum/class-members/
        //     misclassifiedDependencies (~37-45% of the phase).
        //   - reportCodeQuality: the duplicate-block, complexity, feature-flag,
        //     TypeScript-smell, private-type-leak and re-export-cycle detectors. These
        //     are the single most expensive pass — duplicate-block detection alone was
        //     ~83s of a ~130s Sentry scan — so skipping them is an ~8.5x dead-code
        //     speedup on a large repo.
        // Both are provably safe: the consumed graph findings are computed by their own
        // detectors, independent of these passes (confirmed byte-identical on
        // excalidraw + mui-material + sentry). tsConfigPath stays — the module resolver
        // needs it for path-alias resolution in the import graph.
        semantic: { enabled: false },
        reportCodeQuality: false,
      };
      const result = await analyze(defineConfig(config));
      emit({ ok: true, result: normalizeResult(result) });
    } catch (error) {
      emit({ ok: false, error: serializeError(error) });
    }
  })();
});
`;

const resolveTsConfigPath = (rootDirectory: string): string | undefined => {
  for (const filename of TSCONFIG_FILENAMES) {
    const candidate = path.join(rootDirectory, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
};

// HACK: route through `toRelativePath` (which normalizes backslashes to
// forward slashes) so deslop output matches every other diagnostic on
// Windows. Downstream picomatch ignore-pattern matching requires POSIX
// separators or `src/**` overrides silently miss.
const toRelativeFilePath = (rootDirectory: string, filePath: string): string => {
  const relative = toRelativePath(filePath, rootDirectory);
  return relative.length > 0 ? relative : filePath.replace(/\\/g, "/");
};

const parseArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Dead-code worker returned invalid ${label}.`);
  }
  return value;
};

const parseString = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw new Error(`Dead-code worker returned invalid ${label}.`);
  }
  return value;
};

const parseNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number") {
    throw new Error(`Dead-code worker returned invalid ${label}.`);
  }
  return value;
};

const parseBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`Dead-code worker returned invalid ${label}.`);
  }
  return value;
};

const parseStringArray = (value: unknown, label: string): string[] => {
  const values = parseArray(value, label);
  return values.map((entry, index) => parseString(entry, `${label}[${index}]`));
};

const parseUnusedFiles = (value: unknown): DeadCodeWorkerUnusedFile[] => {
  const values = parseArray(value, "unusedFiles");
  const unusedFiles: DeadCodeWorkerUnusedFile[] = [];
  for (const [index, entry] of values.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Dead-code worker returned invalid unusedFiles[${index}].`);
    }
    unusedFiles.push({ path: parseString(entry.path, `unusedFiles[${index}].path`) });
  }
  return unusedFiles;
};

const parseUnusedExports = (value: unknown): DeadCodeWorkerUnusedExport[] => {
  const values = parseArray(value, "unusedExports");
  const unusedExports: DeadCodeWorkerUnusedExport[] = [];
  for (const [index, entry] of values.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Dead-code worker returned invalid unusedExports[${index}].`);
    }
    unusedExports.push({
      path: parseString(entry.path, `unusedExports[${index}].path`),
      name: parseString(entry.name, `unusedExports[${index}].name`),
      line: parseNumber(entry.line, `unusedExports[${index}].line`),
      column: parseNumber(entry.column, `unusedExports[${index}].column`),
      isTypeOnly: parseBoolean(entry.isTypeOnly, `unusedExports[${index}].isTypeOnly`),
    });
  }
  return unusedExports;
};

const parseUnusedDependencies = (value: unknown): DeadCodeWorkerUnusedDependency[] => {
  const values = parseArray(value, "unusedDependencies");
  const unusedDependencies: DeadCodeWorkerUnusedDependency[] = [];
  for (const [index, entry] of values.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Dead-code worker returned invalid unusedDependencies[${index}].`);
    }
    unusedDependencies.push({
      name: parseString(entry.name, `unusedDependencies[${index}].name`),
      isDevDependency: parseBoolean(
        entry.isDevDependency,
        `unusedDependencies[${index}].isDevDependency`,
      ),
    });
  }
  return unusedDependencies;
};

const parseCircularDependencies = (value: unknown): DeadCodeWorkerCircularDependency[] => {
  const values = parseArray(value, "circularDependencies");
  const circularDependencies: DeadCodeWorkerCircularDependency[] = [];
  for (const [index, entry] of values.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Dead-code worker returned invalid circularDependencies[${index}].`);
    }
    circularDependencies.push({
      files: parseStringArray(entry.files, `circularDependencies[${index}].files`),
    });
  }
  return circularDependencies;
};

const parseDeadCodeWorkerResult = (value: unknown): DeadCodeWorkerResult => {
  if (!isRecord(value)) {
    throw new Error("Dead-code worker returned an invalid result.");
  }
  return {
    unusedFiles: parseUnusedFiles(value.unusedFiles),
    unusedExports: parseUnusedExports(value.unusedExports),
    unusedDependencies: parseUnusedDependencies(value.unusedDependencies),
    circularDependencies: parseCircularDependencies(value.circularDependencies),
  };
};

const parseDeadCodeWorkerError = (value: unknown): DeadCodeWorkerError => {
  if (!isRecord(value) || typeof value.message !== "string") {
    return { message: "Dead-code worker failed." };
  }
  return {
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    message: value.message,
    ...(typeof value.stack === "string" ? { stack: value.stack } : {}),
  };
};

const parseDeadCodeWorkerMessage = (
  value: unknown,
): DeadCodeWorkerSuccessMessage | DeadCodeWorkerFailureMessage => {
  if (!isRecord(value)) {
    throw new Error("Dead-code worker returned an invalid message.");
  }
  if (value.ok === true) {
    return { ok: true, result: value.result };
  }
  if (value.ok === false) {
    return { ok: false, error: parseDeadCodeWorkerError(value.error) };
  }
  throw new Error("Dead-code worker returned an invalid status.");
};

const buildDeadCodeWorkerError = (workerError: DeadCodeWorkerError): Error => {
  const error = new Error(workerError.message);
  if (workerError.name !== undefined) error.name = workerError.name;
  if (workerError.stack !== undefined) error.stack = workerError.stack;
  return error;
};

const createDeadCodeWorker: DeadCodeWorkerFactory = (input) => {
  // HACK: run deslop in a child PROCESS (node -e), not a worker_thread.
  // deslop loads native (oxc) NAPI addons; force-terminating a
  // worker_thread that holds native handles intermittently crashes the
  // *host* process on Windows — when the dead-code scan runs inside a
  // vitest fork this surfaced as a silent "Worker exited unexpectedly"
  // and failed CI (see issue: #537 moved deslop inline -> worker_thread).
  // A child process can be killed cleanly on every platform (the same
  // reason the oxlint runner uses child_process + SIGKILL), so teardown
  // on success or timeout never takes the parent down with it. Input
  // goes in as JSON on stdin; the normalized result comes back as JSON
  // on stdout.
  const child = spawn(
    process.execPath,
    [`--max-old-space-size=${DEAD_CODE_WORKER_MAX_OLD_SPACE_MB}`, "-e", DEAD_CODE_WORKER_SCRIPT],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env:
        input.parseConcurrency === undefined
          ? process.env
          : { ...process.env, DESLOP_PARSE_CONCURRENCY: String(input.parseConcurrency) },
    },
  );

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  let didSettle = false;

  const result = new Promise<unknown>((resolve, reject) => {
    const settle = (callback: () => void): void => {
      if (didSettle) return;
      didSettle = true;
      callback();
    };

    child.once("error", (error) => {
      settle(() => reject(error));
    });

    child.once("close", (exitCode) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      if (stdout.length === 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        settle(() =>
          reject(
            new Error(
              `Dead-code worker exited with code ${exitCode ?? "null"}${stderr ? `: ${stderr}` : ""}.`,
            ),
          ),
        );
        return;
      }
      try {
        const parsedMessage = parseDeadCodeWorkerMessage(JSON.parse(stdout));
        if (parsedMessage.ok) {
          settle(() => resolve(parsedMessage.result));
          return;
        }
        settle(() => reject(buildDeadCodeWorkerError(parsedMessage.error)));
      } catch (error) {
        settle(() => reject(error));
      }
    });
  });

  // Swallow EPIPE: if the child is killed (timeout) before we finish
  // writing input, the real failure surfaces via the close/error
  // handlers above.
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(input));

  return {
    result,
    terminate: () => {
      didSettle = true;
      child.kill("SIGKILL");
    },
  };
};

const runDeadCodeWorkerWithTimeout = (
  handle: DeadCodeWorkerHandle,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<unknown> =>
  new Promise<unknown>((resolve, reject) => {
    let didSettle = false;

    // Centralizes the teardown every exit path shares: stop the timer, detach
    // the abort listener, and SIGKILL the child via its `terminate` handle.
    const settle = (finish: () => void): void => {
      if (didSettle) return;
      didSettle = true;
      clearTimeout(timeoutHandle);
      abortSignal?.removeEventListener("abort", onAbort);
      void handle.terminate?.();
      finish();
    };

    const onAbort = (): void => settle(() => reject(new Error("Dead-code worker aborted.")));
    const timeoutHandle = setTimeout(
      () =>
        settle(() =>
          reject(
            new Error(`Dead-code worker timed out after ${timeoutMs / MILLISECONDS_PER_SECOND}s.`),
          ),
        ),
      timeoutMs,
    );
    timeoutHandle.unref?.();

    if (abortSignal?.aborted) {
      onAbort();
      return;
    }
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    handle.result.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });

export const checkDeadCode = async (options: CheckDeadCodeOptions): Promise<Diagnostic[]> => {
  // Canonicalize up front so the deslop graph and its resolver share one
  // path space (see `toCanonicalPath` for why a symlinked root breaks it).
  const rootDirectory = toCanonicalPath(options.rootDirectory);
  if (!fs.existsSync(path.join(rootDirectory, "package.json"))) return [];

  const entryPatterns = collectDeadCodeEntryPatterns(rootDirectory);
  const ignorePatterns = collectDeadCodeIgnorePatterns(rootDirectory);
  const workerHandle = (options.createWorker ?? createDeadCodeWorker)({
    rootDirectory,
    entryPatterns,
    tsConfigPath: resolveTsConfigPath(rootDirectory),
    ignorePatterns,
    deslopJsModuleSpecifier: options.deslopJsModuleSpecifier ?? import.meta.resolve("deslop-js"),
    parseConcurrency: options.parseConcurrency,
  });
  // `runDeadCodeWorkerWithTimeout` owns the abort wiring: when the surrounding
  // Effect fiber is interrupted (lint failed / dead-code phase timeout / scan
  // cancelled), `Effect.tryPromise` aborts `options.abortSignal`, which its
  // `settle()` path turns into an immediate worker SIGKILL — rather than
  // orphaning the child until the in-worker timer expires.
  const rawResult = await runDeadCodeWorkerWithTimeout(
    workerHandle,
    options.workerTimeoutMs ?? DEAD_CODE_WORKER_TIMEOUT_MS,
    options.abortSignal,
  );
  const result = parseDeadCodeWorkerResult(rawResult);
  const toRelative = (filePath: string): string => toRelativeFilePath(rootDirectory, filePath);
  const diagnostics: Diagnostic[] = [];

  for (const unusedFile of result.unusedFiles) {
    diagnostics.push({
      filePath: toRelative(unusedFile.path),
      plugin: DEAD_CODE_PLUGIN,
      rule: "unused-file",
      severity: "warning",
      message:
        "Unused file is not reachable from any entry point, so it adds maintenance surface without shipping any code.",
      help: "Delete the file if it is truly unreachable, or import it from an entry point.",
      line: 0,
      column: 0,
      category: DEAD_CODE_CATEGORY,
    });
  }

  for (const unusedExport of result.unusedExports) {
    const label = unusedExport.isTypeOnly ? "type export" : "export";
    diagnostics.push({
      filePath: toRelative(unusedExport.path),
      plugin: DEAD_CODE_PLUGIN,
      rule: unusedExport.isTypeOnly ? "unused-type" : "unused-export",
      severity: "warning",
      message: `Unused ${label}: \`${unusedExport.name}\` is exported but no module imports it, so it expands the public surface and can mislead callers about supported API.`,
      help: "Drop the `export` keyword (or remove the declaration) if no other module uses this symbol.",
      line: unusedExport.line,
      column: unusedExport.column,
      category: DEAD_CODE_CATEGORY,
    });
  }

  for (const unusedDependency of result.unusedDependencies) {
    const label = unusedDependency.isDevDependency ? "devDependency" : "dependency";
    // Every unused dependency reports at `package.json` with no line, so the
    // renderer lists all of them under one location. Keep the per-item message
    // to just the name and carry the shared rationale in `help` (shown once)
    // rather than repeating the same sentence for each name.
    diagnostics.push({
      filePath: "package.json",
      plugin: DEAD_CODE_PLUGIN,
      rule: unusedDependency.isDevDependency ? "unused-dev-dependency" : "unused-dependency",
      severity: "warning",
      message: `Unused ${label}: \`${unusedDependency.name}\``,
      help: `An unused ${label} adds install time and supply-chain surface without being used; remove it from package.json if it is genuinely unused.`,
      line: 0,
      column: 0,
      category: DEAD_CODE_CATEGORY,
    });
  }

  for (const cycle of result.circularDependencies) {
    if (cycle.files.length === 0) continue;
    diagnostics.push({
      filePath: toRelative(cycle.files[0]),
      plugin: DEAD_CODE_PLUGIN,
      rule: "circular-dependency",
      severity: "warning",
      message: `Circular import cycle: ${cycle.files.map(toRelative).join(" → ")}. Modules in the cycle can observe partially initialized exports, causing order-dependent bugs.`,
      help: "Break the cycle by extracting the shared code into a third module that both files import.",
      line: 0,
      column: 0,
      category: DEAD_CODE_CATEGORY,
    });
  }

  return diagnostics;
};
