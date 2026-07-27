import * as path from "node:path";
import { Command, Option } from "commander";
import {
  DEFAULT_OXLINT_OVERHEAD_SAMPLE_COUNT,
  DEFAULT_OXLINT_OVERHEAD_WARMUP_COUNT,
} from "./constants.ts";
import { parsePositiveInteger, parseUserArguments } from "./parse-performance-arguments.ts";
import type { OxlintOverheadCommandOptions, OxlintOverheadOptions } from "./types.ts";

export const parseOxlintOverheadArguments = (argumentsList: string[]): OxlintOverheadOptions => {
  const command = new Command()
    .name("react-doctor-oxlint-overhead")
    .description("Measure the fixed overhead around React Doctor's oxlint subprocess")
    .addOption(
      new Option("--samples <count>", "measured samples per operation")
        .default(DEFAULT_OXLINT_OVERHEAD_SAMPLE_COUNT)
        .argParser((value) => parsePositiveInteger("--samples", value, false)),
    )
    .addOption(
      new Option("--warmups <count>", "excluded warmup samples per operation")
        .default(DEFAULT_OXLINT_OVERHEAD_WARMUP_COUNT)
        .argParser((value) => parsePositiveInteger("--warmups", value, true)),
    )
    .option("--out <prefix>", "JSON and Markdown output prefix", "tmp/performance/oxlint-overhead")
    .showHelpAfterError()
    .allowExcessArguments(false)
    .exitOverride();
  parseUserArguments(command, argumentsList);
  const commandOptions = command.opts<OxlintOverheadCommandOptions>();
  return {
    samples: commandOptions.samples,
    warmups: commandOptions.warmups,
    outputPrefix: path.resolve(commandOptions.out),
  };
};
