import * as path from "node:path";
import { Command, Option } from "commander";
import {
  DEFAULT_BENCHMARK_MODES,
  DEFAULT_CACHE_COHORTS,
  DEFAULT_OUTPUT_DIRECTORY,
  DEFAULT_SAMPLE_COUNT,
  DEFAULT_WARMUP_COUNT,
  DEFAULT_WORKER_COUNTS,
} from "./constants.ts";
import type {
  BenchmarkCacheCohort,
  BenchmarkCliOptions,
  BenchmarkMode,
  PerformanceCommandOptions,
} from "./types.ts";

export const parsePositiveInteger = (name: string, value: string, allowZero: boolean): number => {
  const parsedValue = Number(value);
  const minimumValue = allowZero ? 0 : 1;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsedValue) || parsedValue < minimumValue) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimumValue}`);
  }
  return parsedValue;
};

const parseModes = (value: string): BenchmarkMode[] => {
  if (value === "all" || value === "both") return ["lint", "full"];
  const modes = value.split(",").map((mode) => {
    if (mode !== "lint" && mode !== "full") throw new Error(`Unknown benchmark mode: ${mode}`);
    return mode;
  });
  return [...new Set(modes)];
};

const parseCacheCohorts = (value: string): BenchmarkCacheCohort[] => {
  if (value === "all") return ["no-cache", "cold", "hot"];
  const cacheCohorts = value.split(",").map((cacheCohort) => {
    if (cacheCohort !== "no-cache" && cacheCohort !== "cold" && cacheCohort !== "hot") {
      throw new Error(`Unknown cache cohort: ${cacheCohort}`);
    }
    return cacheCohort;
  });
  return [...new Set(cacheCohorts)];
};

const parseWorkerCounts = (value: string): Array<number | "auto"> => {
  const workerCounts: Array<number | "auto"> = [];
  for (const workerValue of value.split(",")) {
    if (workerValue === "auto") {
      workerCounts.push("auto");
      continue;
    }
    workerCounts.push(parsePositiveInteger("--workers", workerValue, false));
  }
  return [...new Set(workerCounts)];
};

export interface SharedBenchmarkCommandInput {
  readonly name: string;
  readonly description: string;
  readonly outputDirectoryDefault: string;
  readonly cacheCohortsDefault: readonly string[];
}

export const buildSharedBenchmarkCommand = (input: SharedBenchmarkCommandInput): Command =>
  new Command()
    .name(input.name)
    .description(input.description)
    .addOption(
      new Option("--samples <count>", "measured samples per series")
        .default(DEFAULT_SAMPLE_COUNT)
        .argParser((value) => parsePositiveInteger("--samples", value, false)),
    )
    .addOption(
      new Option("--warmups <count>", "excluded warmup samples per series")
        .default(DEFAULT_WARMUP_COUNT)
        .argParser((value) => parsePositiveInteger("--warmups", value, true)),
    )
    .option(
      "--workers <counts>",
      "comma-separated worker counts or auto",
      DEFAULT_WORKER_COUNTS.join(","),
    )
    .option(
      "--mode <modes>",
      "lint, full, both, or a comma-separated list",
      DEFAULT_BENCHMARK_MODES.join(","),
    )
    .option(
      "--cache <cohorts>",
      "no-cache, cold, hot, all, or a comma-separated list",
      input.cacheCohortsDefault.join(","),
    )
    .option("--out <directory>", "artifact directory", input.outputDirectoryDefault)
    .option(
      "--cli <path>",
      "built React Doctor CLI to benchmark",
      "packages/react-doctor/dist/cli.js",
    )
    .option("--compare <results.json>", "compare against a previous result")
    .option("--profile", "capture V8 CPU profiles in a dedicated sample", false)
    .option("--heap-profile", "capture V8 heap profiles in a dedicated sample", false)
    .showHelpAfterError()
    .allowExcessArguments(false)
    .exitOverride();

export const parseUserArguments = (command: Command, argumentsList: string[]): Command =>
  command.parse(argumentsList[0] === "--" ? argumentsList.slice(1) : argumentsList, {
    from: "user",
  });

export const toBenchmarkCliOptions = (
  commandOptions: PerformanceCommandOptions,
  directories: string[],
): BenchmarkCliOptions => ({
  directories: [...new Set(directories.map((directory) => path.resolve(directory)))],
  samples: commandOptions.samples,
  warmups: commandOptions.warmups,
  workerCounts: parseWorkerCounts(commandOptions.workers),
  modes: parseModes(commandOptions.mode),
  cacheCohorts: parseCacheCohorts(commandOptions.cache),
  outputDirectory: path.resolve(commandOptions.out),
  comparePath: commandOptions.compare ? path.resolve(commandOptions.compare) : null,
  cliPath: path.resolve(commandOptions.cli),
  profile: commandOptions.profile,
  heapProfile: commandOptions.heapProfile,
});

export const parsePerformanceArguments = (argumentsList: string[]): BenchmarkCliOptions => {
  const command = buildSharedBenchmarkCommand({
    name: "react-doctor-performance",
    description: "Benchmark the built React Doctor CLI against arbitrary directories",
    outputDirectoryDefault: DEFAULT_OUTPUT_DIRECTORY,
    cacheCohortsDefault: DEFAULT_CACHE_COHORTS,
  }).argument("<directories...>", "directories to benchmark");
  parseUserArguments(command, argumentsList);
  const directoriesArgument: unknown = command.processedArgs[0];
  const directories = Array.isArray(directoriesArgument)
    ? directoriesArgument.filter((entry): entry is string => typeof entry === "string")
    : [];
  return toBenchmarkCliOptions(command.opts<PerformanceCommandOptions>(), directories);
};
