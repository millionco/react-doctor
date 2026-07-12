import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BENCHMARK_RUNS_DIRECTORY_NAME } from "./constants.ts";
import { createStressProject } from "./create-stress-project.ts";
import { isPathWithin } from "./is-path-within.ts";
import { toBenchmarkCliOptions } from "./parse-performance-arguments.ts";
import { parseStressPerformanceArguments } from "./parse-stress-performance-arguments.ts";
import { runPerformance } from "./run-performance.ts";
import { runCommanderMain } from "./run-commander-main.ts";
import type { PerformanceResult } from "./types.ts";

export const runStressPerformance = (argumentsList: string[]): PerformanceResult => {
  const stressOptions = parseStressPerformanceArguments(argumentsList);
  const outputDirectory = path.resolve(stressOptions.out);
  const projectDirectory = path.resolve(stressOptions.project);
  const runsDirectory = path.join(outputDirectory, BENCHMARK_RUNS_DIRECTORY_NAME);
  if (
    isPathWithin(runsDirectory, projectDirectory) ||
    isPathWithin(projectDirectory, runsDirectory)
  ) {
    throw new Error("Stress project and benchmark runs directories cannot overlap");
  }
  const benchmarkOptions = toBenchmarkCliOptions(stressOptions, [projectDirectory]);
  const stressProject = createStressProject({
    directory: projectDirectory,
    fileCount: stressOptions.files,
    componentsPerFileCount: stressOptions.componentsPerFile,
  });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, "stress-project.json"),
    `${JSON.stringify(stressProject, null, 2)}\n`,
  );
  return runPerformance(benchmarkOptions);
};

const main = (): void => {
  const result = runStressPerformance(process.argv.slice(2));
  process.stdout.write(`${path.join(result.options.outputDirectory, "results.md")}\n`);
  if (result.comparisons.some((comparison) => comparison.classification === "regressed")) {
    process.exitCode = 1;
  }
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCommanderMain(main);
