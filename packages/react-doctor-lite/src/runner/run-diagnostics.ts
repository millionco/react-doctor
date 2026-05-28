import * as os from "node:os";
import { lintSourcesInProcess } from "./lint-sources-in-process.js";
import { readSource } from "./read-source.js";
import { runWorkerPool } from "./worker-pool.js";
import { buildCapabilities } from "../capabilities/build-capabilities.js";
import { DEFAULT_BATCH_SIZE_FILES, WORKER_POOL_MIN_FILES } from "../constants.js";
import {
  buildDependencyGraphFromDisk,
  buildDependencyGraphFromManifest,
} from "../dependency-graph/build-dependency-graph.js";
import { createDependencyGraph } from "../dependency-graph/create-dependency-graph.js";
import { loadRules } from "../rules/load-rules.js";
import { listSourceFiles } from "../utils/list-source-files.js";
import type {
  DependencyGraph,
  DiagnoseInput,
  DiagnoseResult,
  LiteSource,
  LoadedRule,
} from "../types.js";

const resolveDependencyGraph = (input: DiagnoseInput): DependencyGraph => {
  if (input.dependencies) return buildDependencyGraphFromManifest(input.dependencies);
  if (input.cwd) return buildDependencyGraphFromDisk(input.cwd);
  return createDependencyGraph([]);
};

const lintPathsInProcess = (
  filePaths: ReadonlyArray<string>,
  rules: ReadonlyArray<LoadedRule>,
  settings: Record<string, unknown>,
) => {
  const sources: LiteSource[] = [];
  for (const filePath of filePaths) {
    const source = readSource(filePath);
    if (source) sources.push(source);
  }
  return lintSourcesInProcess({ sources, rules, settings });
};

// The orchestrator. Resolves the dependency graph, derives capabilities, gates
// the rule set, enumerates sources, and lints — either in-process (in-memory
// sources, small inputs, or source-mode execution) or across a worker pool.
export const runDiagnostics = async (input: DiagnoseInput): Promise<DiagnoseResult> => {
  const startedAt = performance.now();

  const graph = resolveDependencyGraph(input);
  const capabilities = buildCapabilities(graph);
  const rules = loadRules({ capabilities, selection: input.rules });
  const settings = { ...(input.settings ?? {}) };

  const concurrency = input.concurrency ?? {};
  const poolSize = concurrency.poolSize ?? os.availableParallelism();
  const batchSize = concurrency.batchSize ?? DEFAULT_BATCH_SIZE_FILES;

  let scannedFileCount = 0;
  let ranInWorkerPool = false;
  let diagnostics;

  if (input.sources) {
    // In-memory sources never touch disk, so they always lint in-process.
    scannedFileCount = input.sources.length;
    diagnostics = lintSourcesInProcess({ sources: input.sources, rules, settings });
  } else {
    const filePaths = input.cwd ? listSourceFiles(input.cwd) : [];
    scannedFileCount = filePaths.length;

    const workerModuleIsBuilt = import.meta.url.endsWith(".js");
    const useWorkerPool =
      !concurrency.disableWorkers &&
      poolSize > 1 &&
      workerModuleIsBuilt &&
      filePaths.length >= WORKER_POOL_MIN_FILES;

    if (useWorkerPool) {
      try {
        diagnostics = await runWorkerPool({ filePaths, rules, settings, poolSize, batchSize });
        ranInWorkerPool = true;
      } catch {
        diagnostics = lintPathsInProcess(filePaths, rules, settings);
      }
    } else {
      diagnostics = lintPathsInProcess(filePaths, rules, settings);
    }
  }

  return {
    diagnostics,
    graph: {
      framework: graph.framework,
      packageCount: graph.packages.length,
      reactVersion: graph.getVersion("react"),
      reactMajor: graph.getMajor("react"),
    },
    capabilities: [...capabilities].sort(),
    enabledRuleCount: rules.length,
    scannedFileCount,
    elapsedMilliseconds: Math.round(performance.now() - startedAt),
    ranInWorkerPool,
  };
};
