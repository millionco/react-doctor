import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOxlintPackageDirectory } from "./resolve-paths.js";

export interface OxlintWorkerRuntime {
  readonly workerScriptPath: string;
  readonly oxlintPackageDirectory: string;
}

// Profiling and rule-timing captures are per-process artifacts (V8 writes the
// profile at exit, the plugin flushes timings from an `exit` hook), so they
// only make sense with one short-lived oxlint process per batch.
const LEGACY_SPAWN_ENV_NAMES: ReadonlyArray<string> = [
  "REACT_DOCTOR_CPU_PROFILE_DIR",
  "REACT_DOCTOR_HEAP_PROFILE_DIR",
  "REACT_DOCTOR_OXLINT_TIMINGS_DIR",
  "REACT_DOCTOR_RULE_TIMINGS_DIR",
  "REACT_DOCTOR_DISABLE_OXLINT_WORKER_POOL",
];

const OXLINT_INTERNAL_MODULES: ReadonlyArray<string> = [
  "cli.js",
  "bindings.js",
  "plugins.js",
  "workspace.js",
];

const isLegacySpawnForced = (environment: NodeJS.ProcessEnv): boolean =>
  LEGACY_SPAWN_ENV_NAMES.some((name) => Boolean(environment[name]));

// The worker runs oxlint's internal `dist/*.js` modules, an unstable surface.
// Every path is checked up front so a missing or restructured oxlint simply
// keeps the per-batch spawn path.
export const resolveOxlintWorkerRuntime = (
  environment: NodeJS.ProcessEnv = process.env,
): OxlintWorkerRuntime | null => {
  if (isLegacySpawnForced(environment)) return null;
  const workerScriptPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "oxlint-worker.js",
  );
  if (!fs.existsSync(workerScriptPath)) return null;
  const oxlintPackageDirectory = resolveOxlintPackageDirectory();
  const hasInternalModules = OXLINT_INTERNAL_MODULES.every((fileName) =>
    fs.existsSync(path.join(oxlintPackageDirectory, "dist", fileName)),
  );
  if (!hasInternalModules) return null;
  return { workerScriptPath, oxlintPackageDirectory };
};
