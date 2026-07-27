import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { CommanderError } from "commander";
import { createPersistentOxlintWorkerPool } from "../../packages/core/src/runners/oxlint/create-persistent-oxlint-worker-pool.ts";
import {
  resolveOxlintBinary,
  resolvePluginPath,
} from "../../packages/core/src/runners/oxlint/resolve-paths.ts";
import type { OxlintBatchRunner } from "../../packages/core/src/runners/oxlint/spawn-oxlint.ts";
import { spawnOxlintBatchRunner } from "../../packages/core/src/runners/oxlint/spawn-oxlint.ts";
import { OXLINT_OVERHEAD_WORKLOAD_DEFINITIONS, PERCENT_MULTIPLIER } from "./constants.ts";
import { createOxlintOverheadWorkload } from "./create-oxlint-overhead-workload.ts";
import { parseOxlintOverheadArguments } from "./parse-oxlint-overhead-arguments.ts";
import { parseOxlintJsonSummary } from "./parse-oxlint-json-summary.ts";
import { writeConfig } from "./run-oxlint-overhead.ts";
import { summarizeDistribution } from "./summarize-distribution.ts";
import type {
  DistributionSummary,
  OxlintJsonSummary,
  OxlintOverheadOptions,
  OxlintOverheadWorkloadMetadata,
} from "./types.ts";

const OXLINT_THREAD_COUNT = 1;

interface RunnerSample {
  readonly milliseconds: number;
  readonly summary: OxlintJsonSummary;
}

interface PersistentOxlintComparison {
  readonly workload: OxlintOverheadWorkloadMetadata;
  readonly freshSubprocessMilliseconds: DistributionSummary;
  readonly persistentWorkerMilliseconds: DistributionSummary;
  readonly medianDeltaMilliseconds: number;
  readonly medianSpeedupRatio: number;
  readonly medianReductionPercentage: number;
}

interface PersistentOxlintBenchmarkResult {
  readonly generatedAt: string;
  readonly host: {
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
    readonly nodeVersion: string;
    readonly cpuModel: string;
    readonly cpuCount: number;
  };
  readonly options: OxlintOverheadOptions;
  readonly comparisons: ReadonlyArray<PersistentOxlintComparison>;
  readonly limitations: ReadonlyArray<string>;
}

const runSample = async (
  runner: OxlintBatchRunner,
  argumentsList: ReadonlyArray<string>,
  rootDirectory: string,
): Promise<RunnerSample> => {
  const startedAt = performance.now();
  const output = await runner.run({
    args: argumentsList,
    rootDirectory,
    nodeBinaryPath: process.execPath,
  });
  return {
    milliseconds: performance.now() - startedAt,
    summary: parseOxlintJsonSummary(output),
  };
};

const validateSummary = (summary: OxlintJsonSummary, expectedFileCount: number): void => {
  if (
    summary.fileCount !== expectedFileCount ||
    summary.ruleCount !== 1 ||
    summary.diagnosticCount !== expectedFileCount
  ) {
    throw new Error(`Unexpected persistent-worker benchmark result: ${JSON.stringify(summary)}`);
  }
};

const renderMarkdown = (result: PersistentOxlintBenchmarkResult): string => {
  const rows = result.comparisons
    .map(
      (comparison) =>
        `| ${comparison.workload.label} | ${comparison.workload.sourceFileCount} | ${comparison.freshSubprocessMilliseconds.median.toFixed(2)} | ${comparison.freshSubprocessMilliseconds.medianAbsoluteDeviation.toFixed(2)} | ${comparison.persistentWorkerMilliseconds.median.toFixed(2)} | ${comparison.persistentWorkerMilliseconds.medianAbsoluteDeviation.toFixed(2)} | ${comparison.medianSpeedupRatio.toFixed(2)}x | ${comparison.medianReductionPercentage.toFixed(1)}% |`,
    )
    .join("\n");
  return `# Persistent Oxlint Worker Prototype Benchmark

- Samples: ${result.options.samples}
- Warmups: ${result.options.warmups}
- Oxlint threads: ${OXLINT_THREAD_COUNT}
- Node: ${result.host.nodeVersion}
- Host: ${result.host.platform} ${result.host.architecture}, ${result.host.cpuCount} CPUs

| Workload | Files | Fresh median (ms) | Fresh MAD (ms) | Persistent median (ms) | Persistent MAD (ms) | Speedup | Median reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## Limitations

${result.limitations.map((limitation) => `- ${limitation}`).join("\n")}
`;
};

const runPersistentOxlintBenchmark = async (
  options: OxlintOverheadOptions,
): Promise<PersistentOxlintBenchmarkResult> => {
  const benchmarkDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "react-doctor-persistent-oxlint-overhead-"),
  );
  try {
    const pluginPath = resolvePluginPath();
    const oxlintBinaryPath = resolveOxlintBinary();
    const workerScriptPath = path.resolve(
      "packages/core/tests/fixtures/persistent-oxlint-worker.mjs",
    );
    const configPath = writeConfig(
      benchmarkDirectory,
      "representative-rule.json",
      pluginPath,
      "error",
    );
    const comparisons: PersistentOxlintComparison[] = [];
    for (const workloadDefinition of OXLINT_OVERHEAD_WORKLOAD_DEFINITIONS) {
      const createdWorkload = createOxlintOverheadWorkload(benchmarkDirectory, workloadDefinition);
      const argumentsList = [
        oxlintBinaryPath,
        "-c",
        configPath,
        `--threads=${OXLINT_THREAD_COUNT}`,
        "--disable-nested-config",
        "--format",
        "json",
        createdWorkload.sourceDirectory,
      ];
      const persistentPool = createPersistentOxlintWorkerPool({
        workerCount: 1,
        nodeBinaryPath: process.execPath,
        workerScriptPath,
      });
      const runAndValidate = async (runner: OxlintBatchRunner): Promise<number> => {
        const sample = await runSample(runner, argumentsList, benchmarkDirectory);
        validateSummary(sample.summary, createdWorkload.metadata.sourceFileCount);
        return sample.milliseconds;
      };
      try {
        for (let warmupIndex = 0; warmupIndex < options.warmups; warmupIndex += 1) {
          await runAndValidate(spawnOxlintBatchRunner);
          await runAndValidate(persistentPool);
        }
        const freshSamples: number[] = [];
        const persistentSamples: number[] = [];
        for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
          if (sampleIndex % 2 === 0) {
            freshSamples.push(await runAndValidate(spawnOxlintBatchRunner));
            persistentSamples.push(await runAndValidate(persistentPool));
          } else {
            persistentSamples.push(await runAndValidate(persistentPool));
            freshSamples.push(await runAndValidate(spawnOxlintBatchRunner));
          }
        }
        const freshSubprocessMilliseconds = summarizeDistribution(freshSamples);
        const persistentWorkerMilliseconds = summarizeDistribution(persistentSamples);
        const medianDeltaMilliseconds =
          persistentWorkerMilliseconds.median - freshSubprocessMilliseconds.median;
        comparisons.push({
          workload: createdWorkload.metadata,
          freshSubprocessMilliseconds,
          persistentWorkerMilliseconds,
          medianDeltaMilliseconds,
          medianSpeedupRatio:
            freshSubprocessMilliseconds.median / persistentWorkerMilliseconds.median,
          medianReductionPercentage:
            (-medianDeltaMilliseconds / freshSubprocessMilliseconds.median) * PERCENT_MULTIPLIER,
        });
      } finally {
        await persistentPool.close();
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      host: {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.version,
        cpuModel: os.cpus()[0]?.model ?? "unknown",
        cpuCount: os.availableParallelism(),
      },
      options,
      comparisons,
      limitations: [
        "The persistent worker calls Oxlint 1.74's private minified native binding. Oxlint does not support this ABI, so the prototype is not production-safe.",
        "A second JS-plugin scan otherwise aborts inside Oxlint's native external plugin store. The fixture must clear the private minified lint.js rule table before every request, adding another unsupported implementation dependency.",
        "The private ABI is confined to a test fixture and is not wired into Linter or any published package entry point.",
        "Warmups exclude persistent-worker initialization and first plugin load. Results measure steady-state reuse against a fresh process for every baseline sample.",
        "Fresh and persistent samples alternate order after paired warmups to reduce filesystem-cache and thermal ordering bias.",
        "Each row scans a generated no-eval corpus with one diagnostic per file. It does not represent a production repository's syntax, rule mix, or cross-file behavior.",
        "Both paths use one Oxlint thread and the same config, files, ambient environment, output parsing, and correctness assertions.",
      ],
    };
  } finally {
    fs.rmSync(benchmarkDirectory, { recursive: true, force: true });
  }
};

const main = async (): Promise<void> => {
  const options = parseOxlintOverheadArguments(process.argv.slice(2));
  const result = await runPersistentOxlintBenchmark(options);
  fs.mkdirSync(path.dirname(options.outputPrefix), { recursive: true });
  fs.writeFileSync(`${options.outputPrefix}.json`, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(`${options.outputPrefix}.md`, renderMarkdown(result));
  process.stdout.write(`${options.outputPrefix}.md\n`);
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    if (!(error instanceof CommanderError) || error.code !== "commander.helpDisplayed") throw error;
  }
}
