import * as os from "node:os";
import * as path from "node:path";
import { Command, Option } from "commander";
import {
  DEFAULT_BENCHMARK_MODES,
  DEFAULT_SAMPLE_COUNT,
  DEFAULT_STRESS_COMPONENTS_PER_FILE_COUNT,
  DEFAULT_STRESS_CACHE_COHORTS,
  DEFAULT_STRESS_FILE_COUNT,
  DEFAULT_STRESS_OUTPUT_DIRECTORY,
  DEFAULT_WARMUP_COUNT,
  DEFAULT_WORKER_COUNTS,
  STRESS_PROJECT_DIRECTORY_NAME,
} from "./constants.ts";
import { parsePositiveInteger } from "./parse-positive-integer.ts";
import type { StressPerformanceCommandOptions } from "./types.ts";

export const parseStressPerformanceArguments = (
  argumentsList: string[],
): StressPerformanceCommandOptions => {
  const normalizedArguments = argumentsList[0] === "--" ? argumentsList.slice(1) : argumentsList;
  const command = new Command()
    .name("react-doctor-performance-stress")
    .description("Generate and benchmark a deterministic React stress project")
    .addOption(
      new Option("--files <count>", "generated component files")
        .default(DEFAULT_STRESS_FILE_COUNT)
        .argParser((value) => parsePositiveInteger("--files", value, false)),
    )
    .addOption(
      new Option("--components-per-file <count>", "generated components per file")
        .default(DEFAULT_STRESS_COMPONENTS_PER_FILE_COUNT)
        .argParser((value) => parsePositiveInteger("--components-per-file", value, false)),
    )
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
      DEFAULT_STRESS_CACHE_COHORTS.join(","),
    )
    .option("--out <directory>", "artifact directory", DEFAULT_STRESS_OUTPUT_DIRECTORY)
    .option(
      "--project <directory>",
      "generated stress-project directory",
      path.join(os.tmpdir(), STRESS_PROJECT_DIRECTORY_NAME),
    )
    .option(
      "--cli <path>",
      "built React Doctor CLI to benchmark",
      "packages/react-doctor/dist/cli.js",
    )
    .option("--compare <results.json>", "compare against a previous stress result")
    .option("--profile", "capture V8 CPU profiles in a dedicated sample", false)
    .option("--heap-profile", "capture V8 heap profiles in a dedicated sample", false)
    .showHelpAfterError()
    .allowExcessArguments(false)
    .exitOverride();
  command.parse(normalizedArguments, { from: "user" });
  return command.opts<StressPerformanceCommandOptions>();
};
