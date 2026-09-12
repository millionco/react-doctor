import { type ChildProcess, spawn } from "node:child_process";
import type { OxlintWorkerSpawnSpec } from "../../types/index.js";
import { buildOxlintWorkerNodeArguments } from "../../utils/build-oxlint-worker-node-arguments.js";
import { lowerChildProcessPriority } from "../../utils/lower-child-process-priority.js";
import { resolveOxlintThreadCount } from "../../utils/resolve-oxlint-thread-count.js";
import { setChildProcessRef } from "../../utils/set-child-process-ref.js";
import { resolveChildNodeVersion } from "./resolve-toolchain-versions.js";

// Worker processes boot in ~125 ms (node, oxlint internals, the rule plugin),
// which is longer than the parent's own path to the first lint batch. The
// CLI entry can spawn them before the bundle evaluates; the pool then adopts
// a pre-spawned child whose spawn parameters match exactly instead of
// spawning its own, replaying whatever the child reported meanwhile.
export interface OxlintWorkerSpawnSpecInput {
  readonly nodeBinaryPath: string;
  readonly maxWorkers: number;
  readonly workerScriptPath: string;
  readonly oxlintPackageDirectory: string;
  readonly pluginPath: string | null;
  readonly environment: NodeJS.ProcessEnv;
}

export interface PrespawnedOxlintWorker {
  readonly child: ChildProcess;
  readonly bootMessage: unknown;
  readonly spawnError: Error | null;
  readonly exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | null;
}

interface PrespawnRecord {
  readonly child: ChildProcess;
  bootMessage: unknown;
  spawnError: Error | null;
  exit: PrespawnedOxlintWorker["exit"];
  readonly detach: () => void;
}

const prespawnedBySpecKey = new Map<string, PrespawnRecord[]>();

export const buildOxlintWorkerSpawnSpec = (
  input: OxlintWorkerSpawnSpecInput,
): OxlintWorkerSpawnSpec => ({
  nodeBinaryPath: input.nodeBinaryPath,
  args: [
    ...buildOxlintWorkerNodeArguments({
      childNodeVersion: resolveChildNodeVersion(input.nodeBinaryPath),
      nativeThreadCount: resolveOxlintThreadCount(input.maxWorkers),
    }),
    input.workerScriptPath,
    input.oxlintPackageDirectory,
    ...(input.pluginPath === null ? [] : [input.pluginPath]),
  ],
  environment: input.environment,
});

const toSpecKey = (spec: OxlintWorkerSpawnSpec): string =>
  JSON.stringify([
    spec.nodeBinaryPath,
    spec.args,
    Object.entries(spec.environment).sort(([firstName], [secondName]) =>
      firstName < secondName ? -1 : firstName > secondName ? 1 : 0,
    ),
  ]);

export const spawnOxlintWorkerProcess = (spec: OxlintWorkerSpawnSpec): ChildProcess => {
  const child = spawn(spec.nodeBinaryPath, [...spec.args], {
    env: spec.environment,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  lowerChildProcessPriority(child.pid);
  return child;
};

const prespawnOne = (spec: OxlintWorkerSpawnSpec): PrespawnRecord => {
  const child = spawnOxlintWorkerProcess(spec);
  const onMessage = (message: unknown): void => {
    if (record.bootMessage === null) record.bootMessage = message;
  };
  const onError = (error: Error): void => {
    if (record.spawnError === null) record.spawnError = error;
  };
  const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    record.exit = { code, signal };
  };
  const record: PrespawnRecord = {
    child,
    bootMessage: null,
    spawnError: null,
    exit: null,
    detach: () => {
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("close", onClose);
    },
  };
  child.on("message", onMessage);
  child.on("error", onError);
  child.on("close", onClose);
  // A child nobody adopts must not hold the event loop open; the pool re-refs
  // an adopted one whenever it is running a job.
  setChildProcessRef(child, false);
  return record;
};

export const prespawnOxlintWorkers = (spec: OxlintWorkerSpawnSpec, count: number): void => {
  const specKey = toSpecKey(spec);
  const records = prespawnedBySpecKey.get(specKey) ?? [];
  while (records.length < count) records.push(prespawnOne(spec));
  prespawnedBySpecKey.set(specKey, records);
};

export const takePrespawnedOxlintWorker = (
  spec: OxlintWorkerSpawnSpec,
): PrespawnedOxlintWorker | null => {
  const record = prespawnedBySpecKey.get(toSpecKey(spec))?.shift();
  if (record === undefined) return null;
  record.detach();
  setChildProcessRef(record.child, true);
  return {
    child: record.child,
    bootMessage: record.bootMessage,
    spawnError: record.spawnError,
    exit: record.exit,
  };
};
