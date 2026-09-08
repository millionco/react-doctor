import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { OXLINT_WORKER_JOB_END_MARKER, REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY } from "./constants.js";

export interface OxlintWorkerJobMessage {
  readonly type: "job";
  readonly id: number;
  readonly cwd: string;
  readonly argumentsList: ReadonlyArray<string>;
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
  Array.isArray(message.argumentsList);

const sendToParent = (message: OxlintWorkerBootMessage): void => {
  process.send?.(message);
};

// The plugin module stays loaded between jobs, so its filesystem caches must
// be dropped for each job to see the disk like a fresh process would.
const resetPluginFilesystemCaches = (): void => {
  const resetHook: unknown = Reflect.get(globalThis, REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY);
  if (typeof resetHook === "function") resetHook();
};

const runJob = async (internals: OxlintInternals, job: OxlintWorkerJobMessage): Promise<void> => {
  const workspaceUri = `file:///react-doctor-oxlint-job-${job.id}`;
  let status: OxlintWorkerJobStatus = "error";
  let errorMessage: string | null = null;
  try {
    process.chdir(job.cwd);
    resetPluginFilesystemCaches();
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
  }
  if (errorMessage !== null) fs.writeSync(2, `${errorMessage}\n`);
  writeLine(1, `${OXLINT_WORKER_JOB_END_MARKER}:${job.id}:${status}`);
  writeLine(2, `${OXLINT_WORKER_JOB_END_MARKER}:${job.id}:end`);
};

export const startOxlintWorker = (): void => {
  const oxlintPackageDirectory = process.argv[2];
  process.on("disconnect", () => process.exit(0));
  if (oxlintPackageDirectory === undefined) {
    sendToParent({ type: "unavailable", message: "missing oxlint package directory argument" });
    return;
  }
  setStdioBlocking(process.stdout);
  setStdioBlocking(process.stderr);
  void importOxlintInternals(oxlintPackageDirectory).then(
    (internals) => {
      let queue: Promise<void> = Promise.resolve();
      process.on("message", (message: unknown) => {
        if (!isJobMessage(message)) return;
        queue = queue.then(() => runJob(internals, message));
      });
      sendToParent({ type: "ready" });
    },
    (error: unknown) => {
      sendToParent({
        type: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );
};
