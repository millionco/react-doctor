import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { BENCHMARK_TIMEOUT_MS, BYTES_PER_KIBIBYTE, COMMAND_MAX_BUFFER_BYTES } from "./constants.ts";
import { readBenchmarkReport } from "./read-benchmark-report.ts";
import type {
  BenchmarkCacheCohort,
  BenchmarkMode,
  BenchmarkSample,
  ProcessResourceUsage,
} from "./types.ts";

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

const parseResourceUsage = (stderr: string): ProcessResourceUsage => {
  const darwinTimingMatch = stderr.match(/([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/);
  const darwinResidentSetMatch = stderr.match(/(\d+)\s+maximum resident set size/);
  const linuxUserMatch = stderr.match(/User time \(seconds\):\s*([\d.]+)/);
  const linuxSystemMatch = stderr.match(/System time \(seconds\):\s*([\d.]+)/);
  const linuxResidentSetMatch = stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
  return {
    userSeconds: Number(darwinTimingMatch?.[2] ?? linuxUserMatch?.[1]) || null,
    systemSeconds: Number(darwinTimingMatch?.[3] ?? linuxSystemMatch?.[1]) || null,
    maximumResidentSetBytes: darwinResidentSetMatch
      ? Number(darwinResidentSetMatch[1])
      : linuxResidentSetMatch
        ? Number(linuxResidentSetMatch[1]) * BYTES_PER_KIBIBYTE
        : null,
  };
};

const resolveTimeArguments = (): string[] => {
  if (process.platform === "darwin") return ["-l"];
  if (process.platform === "linux") return ["-v"];
  return [];
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

  const nodeOptions = [
    process.env.NODE_OPTIONS,
    !input.cpuProfile || profileDirectory === null ? null : "--cpu-prof",
    !input.cpuProfile || profileDirectory === null ? null : `--cpu-prof-dir=${profileDirectory}`,
    !input.heapProfile || profileDirectory === null ? null : "--heap-prof",
    !input.heapProfile || profileDirectory === null ? null : `--heap-prof-dir=${profileDirectory}`,
  ]
    .filter((option) => option)
    .join(" ");
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CI: "1",
    GIT_TERMINAL_PROMPT: "0",
    NODE_COMPILE_CACHE: path.join(input.cacheDirectory, "node-compile"),
    REACT_DOCTOR_CACHE_DIR: path.join(input.cacheDirectory, "react-doctor"),
    REACT_DOCTOR_CPU_PROFILE_DIR:
      input.cpuProfile && profileDirectory !== null ? profileDirectory : undefined,
    REACT_DOCTOR_HEAP_PROFILE_DIR:
      input.heapProfile && profileDirectory !== null ? profileDirectory : undefined,
    REACT_DOCTOR_NO_TELEMETRY: "1",
    REACT_DOCTOR_PARALLEL: input.workerCount === "auto" ? undefined : String(input.workerCount),
    SENTRY_TRACES_SAMPLE_RATE: "0",
    ...(input.cacheCohort === "no-cache" ? { REACT_DOCTOR_NO_CACHE: "1" } : {}),
    ...(nodeOptions.length > 0 ? { NODE_OPTIONS: nodeOptions } : {}),
  };
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
  const timeArguments = resolveTimeArguments();
  const executable = timeArguments.length > 0 ? "/usr/bin/time" : process.execPath;
  const executableArguments =
    timeArguments.length > 0 ? [...timeArguments, process.execPath, ...cliArguments] : cliArguments;
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
  const report = readBenchmarkReport(reportPath);
  const resourceUsage = parseResourceUsage(result.stderr);
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
    profileDirectory,
  };
};
