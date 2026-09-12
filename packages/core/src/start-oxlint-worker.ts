import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { OXLINT_WORKER_JOB_END_MARKER, REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY } from "./constants.js";
import { classifyExistenceAnswer } from "./utils/classify-existence-answer.js";
import { createFilesystemCacheEpochGate } from "./utils/create-filesystem-cache-epoch-gate.js";

export interface OxlintWorkerJobMessage {
  readonly type: "job";
  readonly id: number;
  readonly cwd: string;
  readonly argumentsList: ReadonlyArray<string>;
  /**
   * Scan invocation the job belongs to. The filesystem is treated as frozen
   * for one invocation, so plugin caches survive between its jobs and are
   * dropped when the epoch changes; `null` drops them before every job.
   */
  readonly filesystemCacheEpoch: number | null;
}

/**
 * Sidecar dependency-probe collection for a batch of files, run by the warm
 * worker instead of the parent thread: the worker already holds the rule
 * plugin (whose collectors these are) and its filesystem memos, and ten
 * workers collect in parallel while the parent stays free to dispatch.
 */
export interface OxlintWorkerProbeJobMessage {
  readonly type: "probes";
  readonly id: number;
  /** Scan root; probe paths in the result are relative to it. */
  readonly cwd: string;
  readonly files: ReadonlyArray<string>;
  readonly ruleIds: ReadonlyArray<string>;
  readonly filesystemCacheEpoch: number | null;
}

/** One file's probe set as indexes into `OxlintWorkerProbeResult.paths`. */
export interface OxlintWorkerProbeTrace {
  readonly file: string;
  readonly content: ReadonlyArray<number>;
  readonly existence: ReadonlyArray<number>;
}

/**
 * Probe traces for one job, written to stdout as JSON before the end marker.
 * Paths are interned once per job (a batch's files share most dependencies)
 * and each existence-probed path carries its classification so the parent
 * never re-stats it; `null` traces are files the collectors could not
 * fingerprint (the parent stores nothing for them).
 */
export interface OxlintWorkerProbeResult {
  readonly paths: ReadonlyArray<string>;
  readonly existenceAnswers: ReadonlyArray<string | null>;
  readonly traces: ReadonlyArray<OxlintWorkerProbeTrace | null>;
}

export interface OxlintWorkerReadyMessage {
  readonly type: "ready";
}

export interface OxlintWorkerUnavailableMessage {
  readonly type: "unavailable";
  readonly message: string;
}

export type OxlintWorkerBootMessage = OxlintWorkerReadyMessage | OxlintWorkerUnavailableMessage;

export type OxlintWorkerJobStatus = "ok" | "findings" | "error";

type ForwardedFunction = (...forwardedArguments: unknown[]) => unknown;

interface OxlintInternals {
  readonly lint: ForwardedFunction;
  readonly loadPlugin: ForwardedFunction;
  readonly setupRuleConfigs: ForwardedFunction;
  readonly lintFile: ForwardedFunction;
  readonly createWorkspace: ForwardedFunction;
  readonly destroyWorkspace: ForwardedFunction;
  readonly loadJsConfigs: ForwardedFunction;
  /**
   * oxlint's `destroyWorkspace` is a no-op, so every job's workspace (its
   * registered rules, their contexts and the last linted file's AST) stays
   * reachable from the module-level `workspaces` map for the worker's lifetime.
   * The entry is dropped here instead; `null` when the map is not exported.
   */
  readonly workspaces: Map<unknown, unknown> | null;
}

const LINT_IMPORT_PATTERN = /import\s*\{\s*(\w+)\s+as\s+lint\s*\}\s*from\s*"\.\/bindings\.js"/;

const isForwardedFunction = (value: unknown): value is ForwardedFunction =>
  typeof value === "function";

const readFunctionExport = (moduleNamespace: unknown, exportName: string): ForwardedFunction => {
  if (
    typeof moduleNamespace !== "object" ||
    moduleNamespace === null ||
    !(exportName in moduleNamespace)
  ) {
    throw new Error(`oxlint internals do not export "${exportName}"`);
  }
  const exported: unknown = Reflect.get(moduleNamespace, exportName);
  if (!isForwardedFunction(exported)) {
    throw new Error(`oxlint internal export "${exportName}" is not a function`);
  }
  return exported;
};

const readWorkspacesExport = (moduleNamespace: unknown): Map<unknown, unknown> | null => {
  if (
    typeof moduleNamespace !== "object" ||
    moduleNamespace === null ||
    !("workspaces" in moduleNamespace)
  ) {
    return null;
  }
  const exported: unknown = Reflect.get(moduleNamespace, "workspaces");
  return exported instanceof Map ? exported : null;
};

const importOxlintInternals = async (oxlintPackageDirectory: string): Promise<OxlintInternals> => {
  const distDirectory = path.join(oxlintPackageDirectory, "dist");
  const cliSource = fs.readFileSync(path.join(distDirectory, "cli.js"), "utf8");
  const lintExportName = LINT_IMPORT_PATTERN.exec(cliSource)?.[1];
  if (lintExportName === undefined) {
    throw new Error("could not locate oxlint's `lint` binding export");
  }
  const importDist = (fileName: string): Promise<unknown> =>
    import(pathToFileURL(path.join(distDirectory, fileName)).href);
  const [bindings, plugins, workspace] = await Promise.all([
    importDist("bindings.js"),
    importDist("plugins.js"),
    importDist("workspace.js"),
  ]);
  // Same lazy load as oxlint's cli.js: the module only exists in newer
  // oxlint builds and is only needed for `oxlint.config.{js,ts}` users.
  const loadJsConfigs: ForwardedFunction = (...forwarded: unknown[]) =>
    importDist("js_config.js").then((jsConfig) =>
      readFunctionExport(
        jsConfig,
        process.env.VP_VERSION ? "loadVitePlusConfigs" : "loadJsConfigs",
      )(...forwarded),
    );
  return {
    lint: readFunctionExport(bindings, lintExportName),
    loadPlugin: readFunctionExport(plugins, "loadPlugin"),
    setupRuleConfigs: readFunctionExport(plugins, "setupRuleConfigs"),
    lintFile: readFunctionExport(plugins, "lintFile"),
    createWorkspace: readFunctionExport(workspace, "createWorkspace"),
    destroyWorkspace: readFunctionExport(workspace, "destroyWorkspace"),
    loadJsConfigs,
    workspaces: readWorkspacesExport(workspace),
  };
};

// HACK: mirrors oxlint's own cli.js. oxlint's Rust side writes the JSON
// report straight to fd 1; if Node has switched the inherited pipe to
// non-blocking mode those writes can fail with EAGAIN under back-pressure,
// so the fds are forced back to blocking before the first job.
const setStdioBlocking = (stream: NodeJS.WriteStream): void => {
  if (!("_handle" in stream)) return;
  const handle: unknown = stream._handle;
  if (typeof handle !== "object" || handle === null || !("setBlocking" in handle)) return;
  const setBlocking: unknown = handle.setBlocking;
  if (typeof setBlocking === "function") setBlocking.call(handle, true);
};

const writeLine = (fileDescriptor: number, line: string): void => {
  fs.writeSync(fileDescriptor, `\n${line}\n`);
};

const isJobMessage = (message: unknown): message is OxlintWorkerJobMessage =>
  typeof message === "object" &&
  message !== null &&
  "type" in message &&
  message.type === "job" &&
  "id" in message &&
  typeof message.id === "number" &&
  "cwd" in message &&
  typeof message.cwd === "string" &&
  "argumentsList" in message &&
  Array.isArray(message.argumentsList) &&
  "filesystemCacheEpoch" in message &&
  (message.filesystemCacheEpoch === null || typeof message.filesystemCacheEpoch === "number");

const isProbeJobMessage = (message: unknown): message is OxlintWorkerProbeJobMessage =>
  typeof message === "object" &&
  message !== null &&
  "type" in message &&
  message.type === "probes" &&
  "id" in message &&
  typeof message.id === "number" &&
  "cwd" in message &&
  typeof message.cwd === "string" &&
  "files" in message &&
  Array.isArray(message.files) &&
  "ruleIds" in message &&
  Array.isArray(message.ruleIds) &&
  "filesystemCacheEpoch" in message &&
  (message.filesystemCacheEpoch === null || typeof message.filesystemCacheEpoch === "number");

const sendToParent = (message: OxlintWorkerBootMessage): void => {
  process.send?.(message);
};

// The plugin module stays loaded between jobs, so its filesystem caches must
// be dropped whenever a job may see a different disk than the previous one.
const resetPluginFilesystemCaches = (): void => {
  const resetHook: unknown = Reflect.get(globalThis, REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY);
  if (typeof resetHook === "function") resetHook();
};

const filesystemCacheEpochGate = createFilesystemCacheEpochGate();

const idleWorkingDirectory = process.cwd();

// A process's working directory is a lock on Windows: the parent cannot remove a
// scanned project while an idle worker still sits in it.
const leaveJobWorkingDirectory = (): void => {
  try {
    process.chdir(idleWorkingDirectory);
  } catch {
    process.chdir(os.tmpdir());
  }
};

const runJob = async (internals: OxlintInternals, job: OxlintWorkerJobMessage): Promise<void> => {
  const workspaceUri = `file:///react-doctor-oxlint-job-${job.id}`;
  let status: OxlintWorkerJobStatus = "error";
  let errorMessage: string | null = null;
  try {
    process.chdir(job.cwd);
    if (filesystemCacheEpochGate.shouldReset(job.filesystemCacheEpoch)) {
      resetPluginFilesystemCaches();
    }
    internals.createWorkspace(workspaceUri);
    const didPass = await internals.lint(
      job.argumentsList,
      (...forwarded: unknown[]) =>
        internals.loadPlugin(...[...forwarded.slice(0, 3), workspaceUri]),
      (...forwarded: unknown[]) => internals.setupRuleConfigs(...forwarded),
      (...forwarded: unknown[]) => internals.lintFile(...[...forwarded.slice(0, 7), workspaceUri]),
      (...forwarded: unknown[]) => Promise.resolve(internals.createWorkspace(...forwarded)),
      (...forwarded: unknown[]) => internals.destroyWorkspace(...forwarded),
      (...forwarded: unknown[]) => internals.loadJsConfigs(...forwarded),
    );
    status = didPass === false ? "findings" : "ok";
  } catch (error) {
    errorMessage = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    internals.destroyWorkspace(workspaceUri);
    internals.workspaces?.delete(workspaceUri);
    leaveJobWorkingDirectory();
  }
  if (errorMessage !== null) fs.writeSync(2, `${errorMessage}\n`);
  writeLine(1, `${OXLINT_WORKER_JOB_END_MARKER}:${job.id}:${status}`);
  writeLine(2, `${OXLINT_WORKER_JOB_END_MARKER}:${job.id}:end`);
};

// oxlint imports the rule plugin by `file://` URL on a job's first
// `loadPlugin`; evaluating the bundle there costs the first job on every
// worker ~50 ms inside the lint wave. Importing it while the worker boots
// (overlapping project discovery) leaves that job a module-cache hit.
// Best-effort: a failure here surfaces, if at all, as oxlint's own plugin
// load error on the first job.
const preloadPlugin = async (pluginPath: string | undefined): Promise<void> => {
  if (pluginPath === undefined) return;
  try {
    await import(pathToFileURL(pluginPath).href);
  } catch {
    return;
  }
};

type ProbeCollectorModule = typeof import("oxlint-plugin-react-doctor/core");

let probeCollectorModule: Promise<ProbeCollectorModule> | null = null;

// The collectors live in the plugin's core entry, which lint jobs never need.
// It is imported right after the worker reports ready (so readiness is not
// delayed) and settles while the parent is still discovering the project;
// loading it lazily on the first probe job instead cost every worker ~40 ms
// at the tail of the lint wave, more than a trivial chunk of probes is worth.
const loadProbeCollector = (): Promise<ProbeCollectorModule> =>
  (probeCollectorModule ??= import("oxlint-plugin-react-doctor/core"));

const collectProbeTraces = (
  collectCrossFileDependencyProbes: ProbeCollectorModule["collectCrossFileDependencyProbes"],
  job: OxlintWorkerProbeJobMessage,
): OxlintWorkerProbeResult => {
  const paths: string[] = [];
  const existenceAnswers: Array<string | null> = [];
  const pathIndexByRelativePath = new Map<string, number>();
  const internPath = (absolutePath: string, isExistenceProbe: boolean): number => {
    const relativePath = path.relative(job.cwd, absolutePath).replaceAll("\\", "/");
    let pathIndex = pathIndexByRelativePath.get(relativePath);
    if (pathIndex === undefined) {
      pathIndex = paths.length;
      paths.push(relativePath);
      existenceAnswers.push(null);
      pathIndexByRelativePath.set(relativePath, pathIndex);
    }
    if (isExistenceProbe && existenceAnswers[pathIndex] === null) {
      existenceAnswers[pathIndex] = classifyExistenceAnswer(absolutePath);
    }
    return pathIndex;
  };
  const traces = job.files.map((file): OxlintWorkerProbeTrace | null => {
    const absoluteFilePath = path.resolve(job.cwd, file);
    let trace: ReturnType<typeof collectCrossFileDependencyProbes>;
    try {
      trace = collectCrossFileDependencyProbes({
        absoluteFilePath,
        sourceText: fs.readFileSync(absoluteFilePath, "utf8"),
        ruleIds: job.ruleIds,
      });
    } catch {
      return null;
    }
    if (trace === null) return null;
    return {
      file,
      content: [...trace.contentPaths].map((contentPath) => internPath(contentPath, false)),
      existence: [...trace.existencePaths].map((existencePath) => internPath(existencePath, true)),
    };
  });
  return { paths, existenceAnswers, traces };
};

// Same framing as a lint job: the JSON result goes to stdout, the end marker
// carries the status, and any failure surfaces on stderr so the parent falls
// back to collecting that batch in-process.
const runProbeJob = async (job: OxlintWorkerProbeJobMessage): Promise<void> => {
  let status: OxlintWorkerJobStatus = "error";
  let errorMessage: string | null = null;
  try {
    const { collectCrossFileDependencyProbes } = await loadProbeCollector();
    process.chdir(job.cwd);
    if (filesystemCacheEpochGate.shouldReset(job.filesystemCacheEpoch)) {
      resetPluginFilesystemCaches();
    }
    fs.writeSync(1, JSON.stringify(collectProbeTraces(collectCrossFileDependencyProbes, job)));
    status = "ok";
  } catch (error) {
    errorMessage = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    leaveJobWorkingDirectory();
  }
  if (errorMessage !== null) fs.writeSync(2, `${errorMessage}\n`);
  writeLine(1, `${OXLINT_WORKER_JOB_END_MARKER}:${job.id}:${status}`);
  writeLine(2, `${OXLINT_WORKER_JOB_END_MARKER}:${job.id}:end`);
};

export const startOxlintWorker = (): void => {
  const oxlintPackageDirectory = process.argv[2];
  const pluginPath = process.argv[3];
  process.on("disconnect", () => process.exit(0));
  if (oxlintPackageDirectory === undefined) {
    sendToParent({ type: "unavailable", message: "missing oxlint package directory argument" });
    return;
  }
  setStdioBlocking(process.stdout);
  setStdioBlocking(process.stderr);
  void Promise.all([importOxlintInternals(oxlintPackageDirectory), preloadPlugin(pluginPath)]).then(
    ([internals]) => {
      let queue: Promise<void> = Promise.resolve();
      process.on("message", (message: unknown) => {
        if (isProbeJobMessage(message)) {
          queue = queue.then(() => runProbeJob(message));
          return;
        }
        if (!isJobMessage(message)) return;
        queue = queue.then(() => runJob(internals, message));
      });
      sendToParent({ type: "ready" });
      loadProbeCollector().catch(() => undefined);
    },
    (error: unknown) => {
      sendToParent({
        type: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );
};
