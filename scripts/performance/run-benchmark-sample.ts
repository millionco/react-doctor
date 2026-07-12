import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { buildBenchmarkEnvironment } from "./build-benchmark-environment.ts";
import { BENCHMARK_TIMEOUT_MS, COMMAND_MAX_BUFFER_BYTES } from "./constants.ts";
import { parseProcessResourceUsage } from "./parse-process-resource-usage.ts";
import { readBenchmarkReport } from "./read-benchmark-report.ts";
import type { BenchmarkCacheCohort, BenchmarkMode, BenchmarkSample } from "./types.ts";

export interface RunBenchmarkSampleInput {
  repositoryRoot: string;
  cliPath: string;
  targetDirectory: string;
  artifactDirectory: string;
  cacheDirectory: string;
  mode: BenchmarkMode;
  cacheCohort: BenchmarkCacheCohort;
  workerCount: number | "auto";
  sampleIndex: number;
  cpuProfile: boolean;
  heapProfile: boolean;
}

let cachedTimeArguments: string[] | null = null;

const resolveTimeArguments = (): string[] => {
  if (cachedTimeArguments !== null) return cachedTimeArguments;
  if (!fs.existsSync("/usr/bin/time")) {
    cachedTimeArguments = [];
  } else if (process.platform === "darwin") {
    cachedTimeArguments = ["-l"];
  } else if (process.platform === "linux") {
    const versionResult = spawnSync("/usr/bin/time", ["--version"], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    });
    cachedTimeArguments =
      versionResult.status === 0 &&
      `${versionResult.stdout}${versionResult.stderr}`.includes("GNU Time")
        ? ["-v"]
        : [];
  } else {
    cachedTimeArguments = [];
  }
  return cachedTimeArguments;
};

export const runBenchmarkSample = (input: RunBenchmarkSampleInput): BenchmarkSample => {
  fs.mkdirSync(input.artifactDirectory, { recursive: true });
  fs.mkdirSync(input.cacheDirectory, { recursive: true });
  const reportPath = path.join(input.artifactDirectory, `sample-${input.sampleIndex}.report.json`);
  const profileDirectory =
    input.cpuProfile || input.heapProfile
      ? path.join(input.artifactDirectory, `sample-${input.sampleIndex}-profiles`)
      : null;
  if (profileDirectory !== null) fs.mkdirSync(profileDirectory, { recursive: true });

  const environment = buildBenchmarkEnvironment({
    baseEnvironment: process.env,
    cacheDirectory: input.cacheDirectory,
    cacheCohort: input.cacheCohort,
    workerCount: input.workerCount,
    cpuProfile: input.cpuProfile,
    heapProfile: input.heapProfile,
    profileDirectory,
  });
  const cliArguments = [
    input.cliPath,
    input.targetDirectory,
    "--yes",
    "--json",
    "--json-compact",
    "--json-out",
    reportPath,
    "--no-score",
    "--no-supply-chain",
    "--blocking",
    "none",
    ...(input.mode === "lint" ? ["--no-dead-code"] : []),
  ];
  const nodeArguments = [
    ...(input.cpuProfile && profileDirectory !== null
      ? ["--cpu-prof", `--cpu-prof-dir=${profileDirectory}`]
      : []),
    ...(input.heapProfile && profileDirectory !== null
      ? ["--heap-prof", `--heap-prof-dir=${profileDirectory}`]
      : []),
    ...cliArguments,
  ];
  const timeArguments = resolveTimeArguments();
  const executable = timeArguments.length > 0 ? "/usr/bin/time" : process.execPath;
  const executableArguments =
    timeArguments.length > 0
      ? [...timeArguments, process.execPath, ...nodeArguments]
      : nodeArguments;
  const startedAt = performance.now();
  const result = spawnSync(executable, executableArguments, {
    cwd: input.repositoryRoot,
    encoding: "utf8",
    env: environment,
    maxBuffer: COMMAND_MAX_BUFFER_BYTES,
    timeout: BENCHMARK_TIMEOUT_MS,
  });
  const wallMilliseconds = performance.now() - startedAt;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Benchmark scan failed with status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  const report = readBenchmarkReport({
    reportPath,
    targetDirectory: input.targetDirectory,
  });
  const resourceUsage = parseProcessResourceUsage(result.stderr);
  return {
    index: input.sampleIndex,
    wallMilliseconds,
    cliElapsedMilliseconds: report.elapsedMilliseconds,
    userSeconds: resourceUsage.userSeconds,
    systemSeconds: resourceUsage.systemSeconds,
    maximumResidentSetBytes: resourceUsage.maximumResidentSetBytes,
    diagnosticCount: report.diagnosticCount,
    diagnosticHash: report.diagnosticHash,
    scannedFileCount: report.scannedFileCount,
  };
};
