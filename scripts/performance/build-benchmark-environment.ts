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
  const profileDirectory = input.profileDirectory;
  const nodeOptions =
    profileDirectory === null
      ? ""
      : [
          ...(input.cpuProfile ? ["--cpu-prof", "--cpu-prof-dir"] : []),
          ...(input.heapProfile ? ["--heap-prof", "--heap-prof-dir"] : []),
        ]
          .filter((flagName) => process.allowedNodeEnvironmentFlags.has(flagName))
          .map((flagName) =>
            flagName.endsWith("-dir")
              ? `${flagName}=${JSON.stringify(profileDirectory)}`
              : flagName,
          )
          .join(" ");
  return {
    ...input.baseEnvironment,
    CI: "1",
    DESLOP_PARSE_CONCURRENCY: undefined,
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    NODE_COMPILE_CACHE: path.join(input.cacheDirectory, "node-compile"),
    NODE_DISABLE_COMPILE_CACHE: undefined,
    REACT_DOCTOR_CACHE_DIR: path.join(input.cacheDirectory, "react-doctor"),
    REACT_DOCTOR_DEAD_CODE_OVERLAP: undefined,
    REACT_DOCTOR_CPU_PROFILE_DIR:
      input.cpuProfile && input.profileDirectory !== null ? input.profileDirectory : undefined,
    REACT_DOCTOR_HEAP_PROFILE_DIR:
      input.heapProfile && input.profileDirectory !== null ? input.profileDirectory : undefined,
    REACT_DOCTOR_LINT_BATCH_ORDERING: undefined,
    REACT_DOCTOR_NO_CACHE: input.cacheCohort === "no-cache" ? "1" : undefined,
    REACT_DOCTOR_NO_DEAD_CODE_CACHE: undefined,
    REACT_DOCTOR_NO_FILE_CACHE: undefined,
    REACT_DOCTOR_NO_SIDECAR_CACHE: undefined,
    REACT_DOCTOR_NO_TELEMETRY: "1",
    REACT_DOCTOR_OTLP_AUTH_HEADER: undefined,
    REACT_DOCTOR_OTLP_ENDPOINT: undefined,
    REACT_DOCTOR_PARALLEL: input.workerCount === "auto" ? undefined : String(input.workerCount),
    SENTRY_TRACES_SAMPLE_RATE: "0",
    NODE_OPTIONS: nodeOptions.length > 0 ? nodeOptions : undefined,
  };
};
