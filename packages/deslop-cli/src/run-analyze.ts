import { analyze, defineConfig } from "deslop-js";
import type { ScanResult } from "deslop-js";
import type { Writable } from "node:stream";
import {
  EXIT_CODE_INVALID_ROOT,
  EXIT_CODE_ISSUES_FOUND,
  EXIT_CODE_SUCCESS,
  MISSING_PACKAGE_JSON_WARNING,
} from "./constants.js";
import { formatHumanReadableResult, hasCircularIssues, hasUnusedIssues } from "./format-result.js";
import type { AnalyzeOptions } from "./types.js";
import { validateRootDirectory } from "./utils/validate-root-directory.js";

interface AnalyzeOutput {
  stdout: Writable;
  stderr: Writable;
}

const defaultAnalyzeOutput = (): AnalyzeOutput => ({
  stdout: process.stdout,
  stderr: process.stderr,
});

export const resolveAnalyzeExitCode = (
  result: ScanResult,
  options: Pick<AnalyzeOptions, "failOnIssues" | "failOnCycles">,
): number => {
  if (options.failOnIssues && hasUnusedIssues(result)) {
    return EXIT_CODE_ISSUES_FOUND;
  }
  if (options.failOnCycles && hasCircularIssues(result)) {
    return EXIT_CODE_ISSUES_FOUND;
  }
  return EXIT_CODE_SUCCESS;
};

export const runAnalyze = async (
  options: AnalyzeOptions,
  output: AnalyzeOutput = defaultAnalyzeOutput(),
): Promise<number> => {
  const rootValidation = validateRootDirectory(options.root);

  if (!rootValidation.isValid) {
    output.stderr.write(`deslop: ${rootValidation.errorMessage}\n`);
    return EXIT_CODE_INVALID_ROOT;
  }

  if (rootValidation.missingPackageJson) {
    output.stderr.write(`deslop: ${MISSING_PACKAGE_JSON_WARNING}\n`);
  }

  const config = defineConfig({
    rootDir: rootValidation.resolvedPath,
    entryPatterns: options.entry,
    ignorePatterns: options.ignore ?? [],
    includeExtensions: options.extensions,
    tsConfigPath: options.tsconfig,
    paths: options.paths,
    reportTypes: options.reportTypes,
    includeEntryExports: options.includeEntryExports,
  });

  const result: ScanResult = await analyze(config);

  if (options.json) {
    output.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    output.stdout.write(formatHumanReadableResult(result));
  }

  return resolveAnalyzeExitCode(result, options);
};
