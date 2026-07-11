import * as path from "node:path";
import type { BenchmarkCacheCohort } from "./types.ts";

export interface BuildBenchmarkEnvironmentInput {
  readonly baseEnvironment: NodeJS.ProcessEnv;
  readonly cacheDirectory: string;
  readonly cacheCohort: BenchmarkCacheCohort;
  readonly workerCount: number | "auto";
  readonly cpuProfile: boolean;
  readonly heapProfile: boolean;
  readonly profileDirectory: string | null;
}

export const buildBenchmarkEnvironment = (
  input: BuildBenchmarkEnvironmentInput,
): NodeJS.ProcessEnv => {
  const nodeOptions = [
    input.baseEnvironment.NODE_OPTIONS,
    input.cpuProfile &&
    input.profileDirectory !== null &&
    process.allowedNodeEnvironmentFlags.has("--cpu-prof")
      ? "--cpu-prof"
      : null,
    input.cpuProfile &&
    input.profileDirectory !== null &&
    process.allowedNodeEnvironmentFlags.has("--cpu-prof-dir")
      ? `--cpu-prof-dir=${JSON.stringify(input.profileDirectory)}`
      : null,
    input.heapProfile &&
    input.profileDirectory !== null &&
    process.allowedNodeEnvironmentFlags.has("--heap-prof")
      ? "--heap-prof"
      : null,
    input.heapProfile &&
    input.profileDirectory !== null &&
    process.allowedNodeEnvironmentFlags.has("--heap-prof-dir")
      ? `--heap-prof-dir=${JSON.stringify(input.profileDirectory)}`
      : null,
  ]
    .filter((option) => option)
    .join(" ");
  return {
    ...input.baseEnvironment,
    CI: "1",
    GIT_TERMINAL_PROMPT: "0",
    NODE_COMPILE_CACHE: path.join(input.cacheDirectory, "node-compile"),
    REACT_DOCTOR_CACHE_DIR: path.join(input.cacheDirectory, "react-doctor"),
    REACT_DOCTOR_CPU_PROFILE_DIR:
      input.cpuProfile && input.profileDirectory !== null ? input.profileDirectory : undefined,
    REACT_DOCTOR_HEAP_PROFILE_DIR:
      input.heapProfile && input.profileDirectory !== null ? input.profileDirectory : undefined,
    REACT_DOCTOR_NO_CACHE: input.cacheCohort === "no-cache" ? "1" : undefined,
    REACT_DOCTOR_NO_TELEMETRY: "1",
    REACT_DOCTOR_PARALLEL: input.workerCount === "auto" ? undefined : String(input.workerCount),
    SENTRY_TRACES_SAMPLE_RATE: "0",
    NODE_OPTIONS: nodeOptions.length > 0 ? nodeOptions : undefined,
  };
};
