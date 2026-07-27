import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  resolveOxlintBinary,
  resolvePluginPath,
} from "../../packages/core/src/runners/oxlint/resolve-paths.ts";
import { buildBenchmarkEnvironment } from "./build-benchmark-environment.ts";
import { buildOxlintOverheadResiduals } from "./build-oxlint-overhead-residuals.ts";
import { buildOxlintOverheadWorkloadResult } from "./build-oxlint-overhead-workload-result.ts";
import {
  BENCHMARK_TIMEOUT_MS,
  COMMAND_MAX_BUFFER_BYTES,
  OXLINT_OVERHEAD_WORKLOAD_DEFINITIONS,
  REPRESENTATIVE_RULE_CALL_EXPRESSION_COUNT,
} from "./constants.ts";
import { createOxlintOverheadWorkload } from "./create-oxlint-overhead-workload.ts";
import { parseOxlintOverheadArguments } from "./parse-oxlint-overhead-arguments.ts";
import { parseOxlintJsonSummary } from "./parse-oxlint-json-summary.ts";
import { renderOxlintOverheadMarkdown } from "./render-oxlint-overhead-markdown.ts";
import { runCommanderMain } from "./run-commander-main.ts";
import { summarizeDistribution } from "./summarize-distribution.ts";
import type {
  OxlintOverheadMeasurement,
  OxlintOverheadOptions,
  OxlintOverheadResult,
} from "./types.ts";

const REPRESENTATIVE_RULE_KEY = "react-doctor/no-eval";
const OXLINT_THREAD_COUNT = 1;
const EXPECTED_REPRESENTATIVE_DIAGNOSTIC_COUNT = 1;

interface CommandSample {
  readonly wallMilliseconds: number;
  readonly stdout: string;
}

interface MeasurementDefinition {
  readonly id: string;
  readonly label: string;
  readonly method: string;
  readonly run: () => number;
}

interface CreateOxlintConfigInput {
  readonly pluginPath: string | null;
  readonly rootDirectory: string;
  readonly representativeRuleSeverity: "error" | "off" | null;
}

const runCommandSample = (
  command: string,
  argumentsList: string[],
  workingDirectory: string,
  environment: NodeJS.ProcessEnv,
  acceptedStatuses: ReadonlySet<number>,
): CommandSample => {
  const startedAt = performance.now();
  const result = spawnSync(command, argumentsList, {
    cwd: workingDirectory,
    encoding: "utf8",
    env: environment,
    maxBuffer: COMMAND_MAX_BUFFER_BYTES,
    timeout: BENCHMARK_TIMEOUT_MS,
  });
  const wallMilliseconds = performance.now() - startedAt;
  if (result.error) throw result.error;
  const status = result.status ?? -1;
  if (!acceptedStatuses.has(status)) {
    throw new Error(
      `Overhead benchmark command failed with status ${status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return { wallMilliseconds, stdout: result.stdout };
};

const buildRepresentativeSource = (): string =>
  `${Array.from(
    { length: REPRESENTATIVE_RULE_CALL_EXPRESSION_COUNT },
    (_, callExpressionIndex) => `safeCall(${callExpressionIndex});`,
  ).join("\n")}\neval("benchmark");\n`;

export const createOxlintConfig = (input: CreateOxlintConfigInput): object => ({
  categories: {
    correctness: "off",
    suspicious: "off",
    pedantic: "off",
    perf: "off",
    restriction: "off",
    style: "off",
    nursery: "off",
  },
  plugins: [],
  ...(input.pluginPath === null
    ? {}
    : {
        jsPlugins: [input.pluginPath],
        settings: {
          "react-doctor": {
            framework: "unknown",
            rootDirectory: input.rootDirectory,
            capabilities: [],
          },
        },
      }),
  rules:
    input.representativeRuleSeverity === null
      ? {}
      : { [REPRESENTATIVE_RULE_KEY]: input.representativeRuleSeverity },
});

export const writeConfig = (
  directory: string,
  filename: string,
  pluginPath: string | null,
  representativeRuleSeverity: "error" | "off" | null,
): string => {
  const configPath = path.join(directory, filename);
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      createOxlintConfig({
        pluginPath,
        rootDirectory: directory,
        representativeRuleSeverity,
      }),
      null,
      2,
    )}\n`,
  );
  return configPath;
};

const measureDefinition = (
  definition: MeasurementDefinition,
  options: OxlintOverheadOptions,
): OxlintOverheadMeasurement => {
  for (let warmupIndex = 0; warmupIndex < options.warmups; warmupIndex += 1) definition.run();
  const samples: number[] = [];
  for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
    samples.push(definition.run());
  }
  return {
    id: definition.id,
    label: definition.label,
    method: definition.method,
    classification: "direct",
    milliseconds: summarizeDistribution(samples),
  };
};

export const runOxlintOverhead = (options: OxlintOverheadOptions): OxlintOverheadResult => {
  const benchmarkDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "react-doctor-oxlint-overhead-"),
  );
  try {
    const pluginPath = resolvePluginPath();
    if (!fs.existsSync(pluginPath)) {
      throw new Error(`Build oxlint-plugin-react-doctor first: missing ${pluginPath}`);
    }
    const oxlintBinary = resolveOxlintBinary();
    const representativeSource = buildRepresentativeSource();
    const sourcePath = path.join(benchmarkDirectory, "representative.ts");
    fs.writeFileSync(sourcePath, representativeSource);
    const createdWorkloads = OXLINT_OVERHEAD_WORKLOAD_DEFINITIONS.map((definition) =>
      createOxlintOverheadWorkload(benchmarkDirectory, definition),
    );
    const parseConfigPath = writeConfig(benchmarkDirectory, "parse-no-rules.json", null, null);
    const pluginConfigPath = writeConfig(
      benchmarkDirectory,
      "plugin-no-rules.json",
      pluginPath,
      "off",
    );
    const ruleConfigPath = writeConfig(
      benchmarkDirectory,
      "representative-rule.json",
      pluginPath,
      "error",
    );
    const environment = buildBenchmarkEnvironment({
      baseEnvironment: process.env,
      cacheDirectory: path.join(benchmarkDirectory, "cache"),
      cacheCohort: "no-cache",
      workerCount: OXLINT_THREAD_COUNT,
      cpuProfile: false,
      heapProfile: false,
      profileDirectory: null,
    });
    const acceptedSuccessStatus = new Set([0]);
    const acceptedDiagnosticStatuses = new Set([0, 1]);
    const runOxlintScan = (
      scanPath: string,
      expectedFileCount: number,
      configPath: string,
      expectedRuleCount: number,
      expectedDiagnosticCount: number,
    ): number => {
      const sample = runCommandSample(
        process.execPath,
        [
          oxlintBinary,
          "-c",
          configPath,
          `--threads=${OXLINT_THREAD_COUNT}`,
          "--disable-nested-config",
          "--format",
          "json",
          scanPath,
        ],
        benchmarkDirectory,
        environment,
        acceptedDiagnosticStatuses,
      );
      const summary = parseOxlintJsonSummary(sample.stdout);
      if (
        summary.fileCount !== expectedFileCount ||
        summary.ruleCount !== expectedRuleCount ||
        summary.diagnosticCount !== expectedDiagnosticCount
      ) {
        throw new Error(`Unexpected oxlint benchmark result: ${JSON.stringify(summary)}`);
      }
      return sample.wallMilliseconds;
    };
    const pluginImportProgram = [
      'import { performance } from "node:perf_hooks";',
      'import { pathToFileURL } from "node:url";',
      "const startedAt = performance.now();",
      "const pluginModule = await import(pathToFileURL(process.argv[1]).href);",
      "const elapsedMilliseconds = performance.now() - startedAt;",
      "const ruleCount = Object.keys(pluginModule.default.rules).length;",
      "process.stdout.write(JSON.stringify({ elapsedMilliseconds, ruleCount }));",
    ].join("\n");
    let oxlintVersion = "";
    const definitions: MeasurementDefinition[] = [
      {
        id: "node-startup",
        label: "Bare Node startup",
        method: "parent wall clock around a fresh node --input-type=module -e process",
        run: () =>
          runCommandSample(
            process.execPath,
            ["--input-type=module", "-e", ""],
            benchmarkDirectory,
            environment,
            acceptedSuccessStatus,
          ).wallMilliseconds,
      },
      {
        id: "plugin-module-load",
        label: "Plugin module import",
        method: "child performance clock around import() after Node initialized",
        run: () => {
          const sample = runCommandSample(
            process.execPath,
            ["--input-type=module", "-e", pluginImportProgram, pluginPath],
            benchmarkDirectory,
            environment,
            acceptedSuccessStatus,
          );
          const pluginImportResult: unknown = JSON.parse(sample.stdout);
          if (
            typeof pluginImportResult !== "object" ||
            pluginImportResult === null ||
            !("elapsedMilliseconds" in pluginImportResult) ||
            typeof pluginImportResult.elapsedMilliseconds !== "number" ||
            !("ruleCount" in pluginImportResult) ||
            typeof pluginImportResult.ruleCount !== "number" ||
            pluginImportResult.ruleCount === 0
          ) {
            throw new Error("Plugin import benchmark returned an invalid result");
          }
          return pluginImportResult.elapsedMilliseconds;
        },
      },
      {
        id: "oxlint-startup",
        label: "Oxlint CLI/native startup",
        method: "parent wall clock around a fresh oxlint --version process",
        run: () => {
          const sample = runCommandSample(
            process.execPath,
            [oxlintBinary, "--version"],
            benchmarkDirectory,
            environment,
            acceptedSuccessStatus,
          );
          oxlintVersion = sample.stdout.replace(/^Version:\s*/u, "").trim();
          if (oxlintVersion.length === 0) throw new Error("Oxlint returned an empty version");
          return sample.wallMilliseconds;
        },
      },
      {
        id: "parse-no-rules",
        label: "Single-file parse with no rules",
        method: "parent wall clock around oxlint with zero registered rules",
        run: () => runOxlintScan(sourcePath, 1, parseConfigPath, 0, 0),
      },
      {
        id: "plugin-no-rules",
        label: "Single-file plugin load with no rules",
        method:
          "parent wall clock around oxlint with the JS plugin registered, its representative rule explicitly off, and zero active rules",
        run: () => runOxlintScan(sourcePath, 1, pluginConfigPath, 0, 0),
      },
      {
        id: "representative-rule",
        label: "Single-file representative rule",
        method: `parent wall clock around oxlint with only ${REPRESENTATIVE_RULE_KEY}`,
        run: () =>
          runOxlintScan(sourcePath, 1, ruleConfigPath, 1, EXPECTED_REPRESENTATIVE_DIAGNOSTIC_COUNT),
      },
    ];
    const measurements = definitions.map((definition) => measureDefinition(definition, options));
    const oxlintStartupMeasurement = measurements.find(
      (measurement) => measurement.id === "oxlint-startup",
    );
    if (!oxlintStartupMeasurement) throw new Error("Missing oxlint startup measurement");
    const workloads = createdWorkloads.map((createdWorkload) => {
      const workloadMeasurements = [
        {
          id: "parse-no-rules",
          label: "Parse with no rules",
          method: `parent wall clock around oxlint scanning ${createdWorkload.metadata.sourceFileCount} files with zero registered rules`,
          run: () =>
            runOxlintScan(
              createdWorkload.sourceDirectory,
              createdWorkload.metadata.sourceFileCount,
              parseConfigPath,
              0,
              0,
            ),
        },
        {
          id: "plugin-no-rules",
          label: "Plugin load with no rules",
          method: `parent wall clock around oxlint scanning ${createdWorkload.metadata.sourceFileCount} files with the JS plugin registered and zero active rules`,
          run: () =>
            runOxlintScan(
              createdWorkload.sourceDirectory,
              createdWorkload.metadata.sourceFileCount,
              pluginConfigPath,
              0,
              0,
            ),
        },
        {
          id: "representative-rule",
          label: "Representative rule",
          method: `parent wall clock around oxlint scanning ${createdWorkload.metadata.sourceFileCount} files with only ${REPRESENTATIVE_RULE_KEY}`,
          run: () =>
            runOxlintScan(
              createdWorkload.sourceDirectory,
              createdWorkload.metadata.sourceFileCount,
              ruleConfigPath,
              1,
              createdWorkload.metadata.sourceFileCount,
            ),
        },
      ].map((definition) => measureDefinition(definition, options));
      return buildOxlintOverheadWorkloadResult(
        createdWorkload.metadata,
        workloadMeasurements,
        oxlintStartupMeasurement.milliseconds.median,
      );
    });
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      host: {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.version,
        v8Version: process.versions.v8,
        cpuModel: os.cpus()[0]?.model ?? "unknown",
        cpuCount: os.availableParallelism(),
      },
      toolchain: {
        oxlintVersion,
        pluginPath,
        representativeRule: REPRESENTATIVE_RULE_KEY,
        representativeSourceBytes: Buffer.byteLength(representativeSource),
        representativeCallExpressionCount: REPRESENTATIVE_RULE_CALL_EXPRESSION_COUNT,
        oxlintThreadCount: OXLINT_THREAD_COUNT,
      },
      options,
      measurements,
      residuals: buildOxlintOverheadResiduals(measurements),
      workloads,
      limitations: [
        "Oxlint exposes no stable external boundary between native initialization, file I/O, parsing, JS-plugin bridging, and rule dispatch, so residuals are differences between inclusive process measurements.",
        "A negative residual is measurement noise or phase overlap, not negative work.",
        "Plugin import uses a child-local clock; every oxlint row uses the parent wall clock and includes process teardown.",
        "Warmups and measured subprocesses share an isolated Node compile cache, matching repeated spawns in one React Doctor run.",
        "The representative rule is a deterministic no-eval visitor workload, not a model of every rule or project.",
        "The startup share uses oxlint --version as a stable proxy for a fresh process and native CLI initialization; it is not a separately timed phase of a lint scan.",
        "Repository-scale rows scan generated directory trees with one no-eval diagnostic per file; source size and file count model scaling, not a real repository's syntax or rule mix.",
        "All shares divide inferred median differences by the corresponding representative-rule median, so they are comparative estimates rather than additive phase accounting.",
      ],
    };
  } finally {
    fs.rmSync(benchmarkDirectory, { recursive: true, force: true });
  }
};

const main = (): void => {
  const options = parseOxlintOverheadArguments(process.argv.slice(2));
  const result = runOxlintOverhead(options);
  fs.mkdirSync(path.dirname(options.outputPrefix), { recursive: true });
  fs.writeFileSync(`${options.outputPrefix}.json`, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(`${options.outputPrefix}.md`, renderOxlintOverheadMarkdown(result));
  process.stdout.write(`${options.outputPrefix}.md\n`);
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCommanderMain(main);
