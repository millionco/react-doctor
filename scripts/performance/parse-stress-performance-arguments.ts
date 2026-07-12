import * as os from "node:os";
import * as path from "node:path";
import { Option } from "commander";
import {
  DEFAULT_STRESS_COMPONENTS_PER_FILE_COUNT,
  DEFAULT_STRESS_CACHE_COHORTS,
  DEFAULT_STRESS_FILE_COUNT,
  DEFAULT_STRESS_OUTPUT_DIRECTORY,
  STRESS_PROJECT_DIRECTORY_NAME,
} from "./constants.ts";
import {
  buildSharedBenchmarkCommand,
  parsePositiveInteger,
  parseUserArguments,
} from "./parse-performance-arguments.ts";
import type { StressPerformanceCommandOptions } from "./types.ts";

export const parseStressPerformanceArguments = (
  argumentsList: string[],
): StressPerformanceCommandOptions => {
  const command = buildSharedBenchmarkCommand({
    name: "react-doctor-performance-stress",
    description: "Generate and benchmark a deterministic React stress project",
    outputDirectoryDefault: DEFAULT_STRESS_OUTPUT_DIRECTORY,
    cacheCohortsDefault: DEFAULT_STRESS_CACHE_COHORTS,
  })
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
    .option(
      "--project <directory>",
      "generated stress-project directory",
      path.join(os.tmpdir(), STRESS_PROJECT_DIRECTORY_NAME),
    );
  return parseUserArguments(command, argumentsList).opts<StressPerformanceCommandOptions>();
};
