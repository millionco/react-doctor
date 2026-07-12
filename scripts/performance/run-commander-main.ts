import * as fs from "node:fs";
import * as path from "node:path";
import { Command, CommanderError } from "commander";
import { parseUserArguments } from "./parse-performance-arguments.ts";

export const runCommanderMain = (main: () => void): void => {
  try {
    main();
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") return;
    throw error;
  }
};

interface ProfileAnalysisCommandOptions {
  readonly out?: string;
}

export interface ProfileAnalysisMainInput<Analysis> {
  readonly name: string;
  readonly description: string;
  readonly defaultOutputName: string;
  readonly analyze: (profileDirectory: string) => Analysis;
  readonly renderMarkdown: (analysis: Analysis) => string;
}

export const runProfileAnalysisMain = <Analysis>(input: ProfileAnalysisMainInput<Analysis>): void =>
  runCommanderMain(() => {
    const command = new Command()
      .name(input.name)
      .description(input.description)
      .argument("<profile-directory>", "directory containing profile files")
      .option("--out <output-prefix>", "JSON and Markdown output prefix");
    parseUserArguments(command, process.argv.slice(2));
    const commandOptions = command.opts<ProfileAnalysisCommandOptions>();
    const profileDirectoryArgument = command.processedArgs[0];
    if (typeof profileDirectoryArgument !== "string") throw new Error("Missing profile directory");
    const profileDirectory = path.resolve(profileDirectoryArgument);
    const outputPrefix = path.resolve(
      commandOptions.out ?? path.join(profileDirectory, input.defaultOutputName),
    );
    const analysis = input.analyze(profileDirectory);
    fs.writeFileSync(`${outputPrefix}.json`, `${JSON.stringify(analysis, null, 2)}\n`);
    fs.writeFileSync(`${outputPrefix}.md`, input.renderMarkdown(analysis));
    process.stdout.write(`${outputPrefix}.md\n`);
  });
