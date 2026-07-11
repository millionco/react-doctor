import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBenchmarkComparisons } from "./build-benchmark-comparisons.ts";
import { collectTargetMetadata } from "./collect-target-metadata.ts";
import {
  BENCHMARK_RUNS_DIRECTORY_NAME,
  BYTES_PER_MEBIBYTE,
  MILLISECONDS_PER_SECOND,
} from "./constants.ts";
import { parsePerformanceArguments } from "./parse-performance-arguments.ts";
import { renderPerformanceMarkdown } from "./render-performance-markdown.ts";
import { runBenchmarkSample } from "./run-benchmark-sample.ts";
import { summarizeDistribution } from "./summarize-distribution.ts";
import type {
  BenchmarkCacheCohort,
  BenchmarkCliOptions,
  BenchmarkComparisonSeries,
  BenchmarkMode,
  BenchmarkSample,
  BenchmarkSeries,
  BenchmarkTargetMetadata,
  PerformanceResult,
} from "./types.ts";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");

const runGit = (argumentsList: string[]): string | null => {
  const result = spawnSync("git", argumentsList, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
};

const seriesSlug = (
  target: BenchmarkTargetMetadata,
  mode: BenchmarkMode,
  cacheCohort: BenchmarkCacheCohort,
  workerCount: number | "auto",
): string => {
  const directoryHash = createHash("sha256").update(target.directory).digest("hex").slice(0, 8);
  const safeLabel = target.label.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  return `${safeLabel}-${directoryHash}-${mode}-${cacheCohort}-workers-${workerCount}`;
};

const isComparisonSeries = (value: unknown): value is BenchmarkComparisonSeries => {
  if (typeof value !== "object" || value === null) return false;
  if (!("target" in value) || typeof value.target !== "object" || value.target === null) {
    return false;
  }
  if (!("directory" in value.target) || typeof value.target.directory !== "string") return false;
  if ("label" in value.target && typeof value.target.label !== "string") return false;
  if (!("mode" in value) || (value.mode !== "lint" && value.mode !== "full")) return false;
  if (
    !("cacheCohort" in value) ||
    (value.cacheCohort !== "no-cache" &&
      value.cacheCohort !== "cold" &&
      value.cacheCohort !== "hot")
  ) {
    return false;
  }
  if (
    !("workerCount" in value) ||
    (value.workerCount !== "auto" && typeof value.workerCount !== "number")
  ) {
    return false;
  }
  if (
    !("wallMilliseconds" in value) ||
    typeof value.wallMilliseconds !== "object" ||
    value.wallMilliseconds === null
  ) {
    return false;
  }
  return (
    "median" in value.wallMilliseconds &&
    typeof value.wallMilliseconds.median === "number" &&
    "diagnosticHash" in value &&
    typeof value.diagnosticHash === "string"
  );
};

const readBaseline = (baselinePath: string | null): BenchmarkComparisonSeries[] | null => {
  if (baselinePath === null) return null;
  const parsedBaseline: unknown = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (
    typeof parsedBaseline !== "object" ||
    parsedBaseline === null ||
    !("schemaVersion" in parsedBaseline) ||
    parsedBaseline.schemaVersion !== 1 ||
    !("series" in parsedBaseline) ||
    !Array.isArray(parsedBaseline.series) ||
    !parsedBaseline.series.every(isComparisonSeries)
  ) {
    throw new Error(`Invalid performance baseline: ${baselinePath}`);
  }
  return parsedBaseline.series;
};

const cacheDirectoryForSample = (
  seriesDirectory: string,
  cacheCohort: BenchmarkCacheCohort,
  sampleName: string,
): string =>
  cacheCohort === "hot"
    ? path.join(seriesDirectory, "cache", "shared")
    : path.join(seriesDirectory, "cache", sampleName);

const runSeries = (
  options: BenchmarkCliOptions,
  target: BenchmarkTargetMetadata,
  mode: BenchmarkMode,
  cacheCohort: BenchmarkCacheCohort,
  workerCount: number | "auto",
): BenchmarkSeries => {
  const slug = seriesSlug(target, mode, cacheCohort, workerCount);
  const seriesDirectory = path.join(options.outputDirectory, BENCHMARK_RUNS_DIRECTORY_NAME, slug);
  fs.rmSync(seriesDirectory, { recursive: true, force: true });
  fs.mkdirSync(seriesDirectory, { recursive: true });
  process.stderr.write(
    `[${target.label}] ${mode}/${cacheCohort}/workers=${workerCount}: ${options.warmups} warmup, ${options.samples} samples\n`,
  );
  for (let warmupIndex = 0; warmupIndex < options.warmups; warmupIndex += 1) {
    const sampleName = `warmup-${warmupIndex + 1}`;
    runBenchmarkSample({
      repositoryRoot: REPOSITORY_ROOT,
      cliPath: options.cliPath,
      targetDirectory: target.directory,
      artifactDirectory: path.join(seriesDirectory, sampleName),
      cacheDirectory: cacheDirectoryForSample(seriesDirectory, cacheCohort, sampleName),
      mode,
      cacheCohort,
      workerCount,
      sampleIndex: warmupIndex + 1,
      cpuProfile: false,
      heapProfile: false,
    });
  }
  if (options.profile || options.heapProfile) {
    const sampleName = "profile";
    runBenchmarkSample({
      repositoryRoot: REPOSITORY_ROOT,
      cliPath: options.cliPath,
      targetDirectory: target.directory,
      artifactDirectory: path.join(seriesDirectory, sampleName),
      cacheDirectory: cacheDirectoryForSample(seriesDirectory, cacheCohort, sampleName),
      mode,
      cacheCohort,
      workerCount,
      sampleIndex: 0,
      cpuProfile: options.profile,
      heapProfile: options.heapProfile,
    });
  }
  const samples: BenchmarkSample[] = [];
  for (let sampleIndex = 1; sampleIndex <= options.samples; sampleIndex += 1) {
    const sampleName = `sample-${sampleIndex}`;
    const sample = runBenchmarkSample({
      repositoryRoot: REPOSITORY_ROOT,
      cliPath: options.cliPath,
      targetDirectory: target.directory,
      artifactDirectory: path.join(seriesDirectory, sampleName),
      cacheDirectory: cacheDirectoryForSample(seriesDirectory, cacheCohort, sampleName),
      mode,
      cacheCohort,
      workerCount,
      sampleIndex,
      cpuProfile: false,
      heapProfile: false,
    });
    samples.push(sample);
    process.stderr.write(
      `[${target.label}] sample ${sampleIndex}/${options.samples}: ${sample.wallMilliseconds.toFixed(1)} ms\n`,
    );
  }
  const diagnosticHashes = new Set(samples.map((sample) => sample.diagnosticHash));
  if (diagnosticHashes.size !== 1) {
    throw new Error(`Diagnostic output changed between samples for ${slug}`);
  }
  const wallMilliseconds = summarizeDistribution(samples.map((sample) => sample.wallMilliseconds));
  const elapsedSeconds = wallMilliseconds.median / MILLISECONDS_PER_SECOND;
  const maximumResidentSetValues = samples.flatMap((sample) =>
    sample.maximumResidentSetBytes === null ? [] : [sample.maximumResidentSetBytes],
  );
  return {
    target,
    mode,
    cacheCohort,
    workerCount,
    samples,
    wallMilliseconds,
    cliElapsedMilliseconds: summarizeDistribution(
      samples.map((sample) => sample.cliElapsedMilliseconds),
    ),
    maximumResidentSetBytes:
      maximumResidentSetValues.length === 0
        ? null
        : summarizeDistribution(maximumResidentSetValues),
    filesPerSecond: (samples[0]?.scannedFileCount ?? target.sourceFileCount) / elapsedSeconds,
    mebibytesPerSecond: target.sourceByteCount / BYTES_PER_MEBIBYTE / elapsedSeconds,
    diagnosticHash: samples[0]?.diagnosticHash ?? "",
  };
};

const assertCrossSeriesCorrectness = (seriesList: BenchmarkSeries[]): void => {
  const hashesByTargetAndMode = new Map<string, Set<string>>();
  for (const series of seriesList) {
    const key = `${series.target.directory}::${series.mode}`;
    const hashes = hashesByTargetAndMode.get(key) ?? new Set<string>();
    hashes.add(series.diagnosticHash);
    hashesByTargetAndMode.set(key, hashes);
  }
  for (const [key, hashes] of hashesByTargetAndMode) {
    if (hashes.size !== 1) throw new Error(`Diagnostic output changed across cohorts for ${key}`);
  }
};

export const runPerformance = (options: BenchmarkCliOptions): PerformanceResult => {
  if (!fs.existsSync(options.cliPath)) {
    throw new Error(`Build React Doctor first: missing ${options.cliPath}`);
  }
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const targets = options.directories.map(collectTargetMetadata);
  const series: BenchmarkSeries[] = [];
  for (const target of targets) {
    for (const mode of options.modes) {
      for (const cacheCohort of options.cacheCohorts) {
        for (const workerCount of options.workerCounts) {
          series.push(runSeries(options, target, mode, cacheCohort, workerCount));
        }
      }
    }
  }
  assertCrossSeriesCorrectness(series);
  const baseline = readBaseline(options.comparePath);
  const reactDoctorStatus = runGit(["status", "--short", "--untracked-files=normal"]);
  const result: PerformanceResult = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    reactDoctorGitSha: runGit(["rev-parse", "HEAD"]),
    reactDoctorIsDirty: reactDoctorStatus === null ? null : reactDoctorStatus.length > 0,
    host: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      cpuCount: os.availableParallelism(),
      totalMemoryBytes: os.totalmem(),
      hostname: os.hostname(),
    },
    options: {
      samples: options.samples,
      warmups: options.warmups,
      workerCounts: options.workerCounts,
      modes: options.modes,
      cacheCohorts: options.cacheCohorts,
      outputDirectory: options.outputDirectory,
      cliPath: options.cliPath,
      profile: options.profile,
      heapProfile: options.heapProfile,
    },
    series,
    comparisons: buildBenchmarkComparisons(series, baseline),
  };
  fs.writeFileSync(
    path.join(options.outputDirectory, "results.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(options.outputDirectory, "results.md"),
    renderPerformanceMarkdown(result),
  );
  return result;
};

const main = (): void => {
  const options = parsePerformanceArguments(process.argv.slice(2));
  const result = runPerformance(options);
  process.stdout.write(`${path.join(options.outputDirectory, "results.md")}\n`);
  if (result.comparisons.some((comparison) => comparison.classification === "regressed")) {
    process.exitCode = 1;
  }
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
