import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { buildBenchmarkEnvironment } from "./build-benchmark-environment.ts";
import {
  BENCHMARK_TIMEOUT_MS,
  COMMAND_MAX_BUFFER_BYTES,
  OXLINT_SPAWN_LOG_FILENAME_SUFFIX,
} from "./constants.ts";
import { parseOxlintSpawnLog } from "./parse-oxlint-spawn-log.ts";
import { parseProcessResourceUsage } from "./parse-process-resource-usage.ts";
import { readBenchmarkReport } from "./read-benchmark-report.ts";
import { summarizeScanTimeline } from "./summarize-scan-timeline.ts";
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
  ruleTimings: boolean;
}

interface TimeCommand {
  executable: string;
  prefixArguments: string[];
}

let cachedTimeCommand: TimeCommand | null = null;

const hasExecutable = (executable: string): boolean => {
  try {
    fs.accessSync(executable, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveTimeCommand = (): TimeCommand | null => {
  if (cachedTimeCommand !== null) return cachedTimeCommand;
  const bashFallback: TimeCommand | null = hasExecutable("/bin/bash")
    ? { executable: "/bin/bash", prefixArguments: ["-c", 'time -p "$@"', "bash"] }
    : null;
  if (!hasExecutable("/usr/bin/time")) {
    cachedTimeCommand = bashFallback;
  } else if (process.platform === "darwin") {
    cachedTimeCommand = { executable: "/usr/bin/time", prefixArguments: ["-l"] };
  } else if (process.platform === "linux") {
    const versionResult = spawnSync("/usr/bin/time", ["--version"], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    });
    cachedTimeCommand =
      versionResult.status === 0 &&
      `${versionResult.stdout}${versionResult.stderr}`.includes("GNU Time")
        ? { executable: "/usr/bin/time", prefixArguments: ["-v"] }
        : bashFallback;
  } else {
    cachedTimeCommand = bashFallback;
  }
  return cachedTimeCommand;
};

export const runBenchmarkSample = (input: RunBenchmarkSampleInput): BenchmarkSample => {
  fs.mkdirSync(input.artifactDirectory, { recursive: true });
  fs.mkdirSync(input.cacheDirectory, { recursive: true });
  const reportPath = path.join(input.artifactDirectory, `sample-${input.sampleIndex}.report.json`);
  const profileDirectory =
    input.cpuProfile || input.heapProfile || input.ruleTimings
      ? path.join(input.artifactDirectory, `sample-${input.sampleIndex}-profiles`)
      : null;
  if (profileDirectory !== null) fs.mkdirSync(profileDirectory, { recursive: true });
  const spawnLogPath = path.join(
    input.artifactDirectory,
    `sample-${input.sampleIndex}${OXLINT_SPAWN_LOG_FILENAME_SUFFIX}`,
  );
  fs.rmSync(spawnLogPath, { force: true });

  const environment = buildBenchmarkEnvironment({
    baseEnvironment: process.env,
    cacheDirectory: input.cacheDirectory,
    cacheCohort: input.cacheCohort,
    workerCount: input.workerCount,
    cpuProfile: input.cpuProfile,
    heapProfile: input.heapProfile,
    ruleTimings: input.ruleTimings,
    profileDirectory,
    spawnLogPath,
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
  const timeCommand = resolveTimeCommand();
  const executable = timeCommand === null ? process.execPath : timeCommand.executable;
  const executableArguments =
    timeCommand === null
      ? nodeArguments
      : [...timeCommand.prefixArguments, process.execPath, ...nodeArguments];
  const scanStartedAt = Date.now();
  const startedAt = performance.now();
  const result = spawnSync(executable, executableArguments, {
    cwd: input.repositoryRoot,
    encoding: "utf8",
    env: environment,
    maxBuffer: COMMAND_MAX_BUFFER_BYTES,
    timeout: BENCHMARK_TIMEOUT_MS,
  });
  const wallMilliseconds = performance.now() - startedAt;
  const scanEndedAt = Date.now();
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
  const timeline = fs.existsSync(spawnLogPath)
    ? summarizeScanTimeline({
        spawnLog: parseOxlintSpawnLog(fs.readFileSync(spawnLogPath, "utf8")),
        scanStartedAt,
        scanEndedAt,
      })
    : null;
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
    timeline,
  };
};
