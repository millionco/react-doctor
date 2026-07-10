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
import { parsePositiveInteger } from "./parse-positive-integer.ts";
import type { BenchmarkCacheCohort, BenchmarkCliOptions, BenchmarkMode } from "./types.ts";

interface PerformanceCommandOptions {
  samples: number;
  warmups: number;
  workers: string;
  mode: string;
  cache: string;
  out: string;
  compare?: string;
  cli: string;
  profile: boolean;
  heapProfile: boolean;
}

const parseModes = (value: string): BenchmarkMode[] => {
  if (value === "all" || value === "both") return ["lint", "full"];
  const modes = value.split(",");
  for (const mode of modes) {
    if (mode !== "lint" && mode !== "full") {
      throw new Error(`Unknown benchmark mode: ${mode}`);
    }
  }
  return [...new Set(modes)];
};

const parseCacheCohorts = (value: string): BenchmarkCacheCohort[] => {
  if (value === "all") return ["no-cache", "cold", "hot"];
  const cacheCohorts = value.split(",");
  for (const cacheCohort of cacheCohorts) {
    if (cacheCohort !== "no-cache" && cacheCohort !== "cold" && cacheCohort !== "hot") {
      throw new Error(`Unknown cache cohort: ${cacheCohort}`);
    }
  }
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

export const parsePerformanceArguments = (argumentsList: string[]): BenchmarkCliOptions => {
  const normalizedArguments = argumentsList[0] === "--" ? argumentsList.slice(1) : argumentsList;
  const command = new Command()
    .name("react-doctor-performance")
    .description("Benchmark the built React Doctor CLI against arbitrary directories")
    .argument("<directories...>", "directories to benchmark")
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
      DEFAULT_CACHE_COHORTS.join(","),
    )
    .option("--out <directory>", "artifact directory", DEFAULT_OUTPUT_DIRECTORY)
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
  command.parse(normalizedArguments, { from: "user" });
  const commandOptions = command.opts<PerformanceCommandOptions>();
  const directories = command.processedArgs.flatMap((argument) =>
    Array.isArray(argument)
      ? argument.filter((entry) => typeof entry === "string")
      : typeof argument === "string"
        ? [argument]
        : [],
  );
  return {
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
  };
};
