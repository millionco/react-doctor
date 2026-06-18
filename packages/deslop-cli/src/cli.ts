import { Command, type OptionValues } from "commander";
import { DEFAULT_ROOT_DIRECTORY, EXIT_CODE_RUNTIME_ERROR } from "./constants.js";
import type { AnalyzeOptions } from "./types.js";
import { runAnalyze } from "./run-analyze.js";
import { readPackageVersion } from "./utils/read-package-version.js";

const parsePathsOption = (rawPaths: string[] | undefined): Record<string, string[]> | undefined => {
  if (!rawPaths || rawPaths.length === 0) return undefined;
  const pathMap: Record<string, string[]> = {};
  for (const entry of rawPaths) {
    const separatorIndex = entry.indexOf("=");
    const pattern = separatorIndex === -1 ? "" : entry.slice(0, separatorIndex);
    const target = separatorIndex === -1 ? "" : entry.slice(separatorIndex + 1);
    if (!pattern || !target) {
      process.stderr.write(
        `deslop: ignoring malformed --paths entry "${entry}" (expected "alias=target", e.g. "@app/*=src/*")\n`,
      );
      continue;
    }
    const existing = pathMap[pattern];
    if (existing) {
      existing.push(target);
    } else {
      pathMap[pattern] = [target];
    }
  }
  return Object.keys(pathMap).length > 0 ? pathMap : undefined;
};

const toAnalyzeOptions = (
  root: string | undefined,
  optionValues: OptionValues,
): AnalyzeOptions => ({
  root: root ?? DEFAULT_ROOT_DIRECTORY,
  entry: optionValues.entry,
  ignore: optionValues.ignore,
  extensions: optionValues.extensions,
  tsconfig: optionValues.tsconfig,
  paths: parsePathsOption(optionValues.paths),
  reportTypes: Boolean(optionValues.reportTypes),
  includeEntryExports: Boolean(optionValues.includeEntryExports),
  json: Boolean(optionValues.json),
  failOnIssues: Boolean(optionValues.failOnIssues),
  failOnCycles: Boolean(optionValues.failOnCycles),
});

const runAnalyzeAction = async (
  root: string | undefined,
  optionValues: OptionValues,
): Promise<void> => {
  const exitCode = await runAnalyze(toAnalyzeOptions(root, optionValues));
  process.exitCode = exitCode;
};

const addAnalyzeOptions = (command: Command): Command =>
  command
    .argument("[root]", "project root directory", DEFAULT_ROOT_DIRECTORY)
    .option("-e, --entry <pattern...>", "entry point glob patterns")
    .option("-i, --ignore <pattern...>", "glob patterns to exclude from analysis")
    .option("--extensions <extension...>", "file extensions to scan (e.g. .ts .vue)")
    .option("--tsconfig <path>", "path to tsconfig.json for path alias resolution")
    .option("--paths <alias=target...>", "path alias mappings (e.g. @lib/*=src/lib/*)")
    .option("--report-types", "include type-only exports in results")
    .option("--include-entry-exports", "report unused exports from entry files")
    .option("--json", "output results as JSON")
    .option(
      "--fail-on-issues",
      "exit with code 1 when unused files, exports, or dependencies are found",
    )
    .option("--fail-on-cycles", "exit with code 1 when circular imports are found");

const program = new Command();

program
  .name("deslop")
  .description(
    "Find unused files, exports, dependencies, and circular imports in JavaScript projects",
  )
  .version(readPackageVersion(import.meta.url));

addAnalyzeOptions(program).action(runAnalyzeAction);

addAnalyzeOptions(
  program
    .command("analyze")
    .description("Find unused files, exports, dependencies, and circular imports"),
).action(runAnalyzeAction);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`deslop: ${message}\n`);
  process.exitCode = EXIT_CODE_RUNTIME_ERROR;
});
