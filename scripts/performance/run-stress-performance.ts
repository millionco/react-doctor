import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { clearBenchmarkRunArtifacts } from "./clear-benchmark-run-artifacts.ts";
import { createStressProject } from "./create-stress-project.ts";
import { parsePerformanceArguments } from "./parse-performance-arguments.ts";
import { parseStressPerformanceArguments } from "./parse-stress-performance-arguments.ts";
import { runPerformance } from "./run-performance.ts";

const main = (): void => {
  const stressOptions = parseStressPerformanceArguments(process.argv.slice(2));
  const outputDirectory = path.resolve(stressOptions.out);
  const projectDirectory = path.resolve(stressOptions.project);
  clearBenchmarkRunArtifacts(outputDirectory);
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
  const benchmarkOptions = parsePerformanceArguments([
    projectDirectory,
    "--samples",
    String(stressOptions.samples),
    "--warmups",
    String(stressOptions.warmups),
    "--workers",
    stressOptions.workers,
    "--mode",
    stressOptions.mode,
    "--cache",
    stressOptions.cache,
    "--out",
    outputDirectory,
    "--cli",
    stressOptions.cli,
    ...(stressOptions.compare ? ["--compare", stressOptions.compare] : []),
    ...(stressOptions.profile ? ["--profile"] : []),
    ...(stressOptions.heapProfile ? ["--heap-profile"] : []),
  ]);
  const result = runPerformance(benchmarkOptions);
  process.stdout.write(`${path.join(outputDirectory, "results.md")}\n`);
  if (result.comparisons.some((comparison) => comparison.classification === "regressed")) {
    process.exitCode = 1;
  }
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
