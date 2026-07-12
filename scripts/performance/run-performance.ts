import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBenchmarkComparisons } from "./build-benchmark-comparisons.ts";
import { clearBenchmarkRunArtifacts } from "./clear-benchmark-run-artifacts.ts";
import {
  BENCHMARK_RUNS_DIRECTORY_NAME,
  BYTES_PER_MEBIBYTE,
  FALLBACK_IGNORED_DIRECTORY_NAMES,
  MILLISECONDS_PER_SECOND,
  SOURCE_FILE_EXTENSIONS,
} from "./constants.ts";
import { isPathWithin } from "./is-path-within.ts";
import { isRecordWithFields } from "./is-record-with-fields.ts";
import { parsePerformanceArguments } from "./parse-performance-arguments.ts";
import { renderPerformanceMarkdown } from "./render-performance-markdown.ts";
import { runBenchmarkSample } from "./run-benchmark-sample.ts";
import { runCommanderMain } from "./run-commander-main.ts";
import { summarizeDistribution } from "./summarize-distribution.ts";
import type {
  BenchmarkCacheCohort,
  BenchmarkCliOptions,
  BenchmarkComparisonSeries,
  BenchmarkMode,
  BenchmarkSample,
  BenchmarkSeries,
  BenchmarkTargetMetadata,
  HostMetadata,
  PerformanceResult,
} from "./types.ts";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");

const runGit = (directory: string, argumentsList: string[]): string | null => {
  const result = spawnSync("git", argumentsList, {
    cwd: directory,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout : null;
};

const collectFallbackSourceFiles = (directory: string): string[] => {
  const sourceFiles: string[] = [];
  const pendingDirectories = [directory];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (currentDirectory === undefined) continue;
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!FALLBACK_IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          pendingDirectories.push(entryPath);
        }
      } else if (SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
        sourceFiles.push(entryPath);
      }
    }
  }
  return sourceFiles;
};

const collectTargetMetadata = (directory: string, targetId: string): BenchmarkTargetMetadata => {
  const directoryStats = fs.statSync(directory);
  if (!directoryStats.isDirectory())
    throw new Error(`Benchmark target is not a directory: ${directory}`);
  const gitFilesOutput = runGit(directory, ["ls-files", "-co", "--exclude-standard", "-z"]);
  const sourceFiles =
    gitFilesOutput === null
      ? collectFallbackSourceFiles(directory)
      : gitFilesOutput
          .split("\0")
          .filter((relativePath) => SOURCE_FILE_EXTENSIONS.has(path.extname(relativePath)))
          .map((relativePath) => path.resolve(directory, relativePath))
          .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  sourceFiles.sort();
  const sourceByteCount = sourceFiles.reduce(
    (totalBytes, filePath) => totalBytes + fs.statSync(filePath).size,
    0,
  );
  const sourceFingerprintHash = createHash("sha256");
  for (const filePath of sourceFiles) {
    sourceFingerprintHash.update(path.relative(directory, filePath));
    sourceFingerprintHash.update("\0");
    sourceFingerprintHash.update(fs.readFileSync(filePath));
    sourceFingerprintHash.update("\0");
  }
  const gitSha = runGit(directory, ["rev-parse", "HEAD"])?.trim() || null;
  const gitStatus = runGit(directory, ["status", "--short", "--untracked-files=normal", "--", "."]);
  return {
    targetId,
    directory,
    label: path.basename(directory),
    gitSha,
    isGitDirty: gitStatus === null ? null : gitStatus.trim().length > 0,
    sourceFileCount: sourceFiles.length,
    sourceByteCount,
    sourceFingerprint: sourceFingerprintHash.digest("hex"),
  };
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

const isComparisonSeries = (value: unknown): value is BenchmarkComparisonSeries =>
  isRecordWithFields(value, { diagnosticHash: "string" }) &&
  isRecordWithFields(value.target, {
    targetId: "string",
    directory: "string",
    sourceFileCount: "number",
    sourceByteCount: "number",
    sourceFingerprint: "string",
  }) &&
  (!("label" in value.target) || typeof value.target.label === "string") &&
  (value.mode === "lint" || value.mode === "full") &&
  (value.cacheCohort === "no-cache" ||
    value.cacheCohort === "cold" ||
    value.cacheCohort === "hot") &&
  (value.workerCount === "auto" || typeof value.workerCount === "number") &&
  isRecordWithFields(value.wallMilliseconds, { median: "number" });

const isHostMetadata = (value: unknown): value is HostMetadata =>
  isRecordWithFields(value, {
    platform: "string",
    architecture: "string",
    nodeVersion: "string",
    v8Version: "string",
    cpuModel: "string",
    cpuCount: "number",
    totalMemoryBytes: "number",
    hostname: "string",
  });

const readBaseline = (
  baselinePath: string | null,
  currentHost: HostMetadata,
): BenchmarkComparisonSeries[] | null => {
  if (baselinePath === null) return null;
  const parsedBaseline: unknown = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (
    typeof parsedBaseline !== "object" ||
    parsedBaseline === null ||
    !("schemaVersion" in parsedBaseline) ||
    parsedBaseline.schemaVersion !== 1 ||
    !("host" in parsedBaseline) ||
    !isHostMetadata(parsedBaseline.host) ||
    !("series" in parsedBaseline) ||
    !Array.isArray(parsedBaseline.series) ||
    !parsedBaseline.series.every(isComparisonSeries)
  ) {
    throw new Error(`Invalid performance baseline: ${baselinePath}`);
  }
  const baselineHost = parsedBaseline.host;
  if (
    baselineHost.platform !== currentHost.platform ||
    baselineHost.architecture !== currentHost.architecture ||
    baselineHost.nodeVersion !== currentHost.nodeVersion ||
    baselineHost.v8Version !== currentHost.v8Version ||
    baselineHost.cpuModel !== currentHost.cpuModel ||
    baselineHost.cpuCount !== currentHost.cpuCount
  ) {
    throw new Error(`Performance baseline host does not match the current host: ${baselinePath}`);
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
  const runSample = (
    sampleName: string,
    sampleIndex: number,
    cpuProfile: boolean,
    heapProfile: boolean,
  ): BenchmarkSample =>
    runBenchmarkSample({
      repositoryRoot: REPOSITORY_ROOT,
      cliPath: options.cliPath,
      targetDirectory: target.directory,
      artifactDirectory: path.join(seriesDirectory, sampleName),
      cacheDirectory: cacheDirectoryForSample(seriesDirectory, cacheCohort, sampleName),
      mode,
      cacheCohort,
      workerCount,
      sampleIndex,
      cpuProfile,
      heapProfile,
    });
  for (let warmupIndex = 0; warmupIndex < options.warmups; warmupIndex += 1) {
    runSample(`warmup-${warmupIndex + 1}`, warmupIndex + 1, false, false);
  }
  const samples: BenchmarkSample[] = [];
  for (let sampleIndex = 1; sampleIndex <= options.samples; sampleIndex += 1) {
    const sample = runSample(`sample-${sampleIndex}`, sampleIndex, false, false);
    samples.push(sample);
    process.stderr.write(
      `[${target.label}] sample ${sampleIndex}/${options.samples}: ${sample.wallMilliseconds.toFixed(1)} ms\n`,
    );
  }
  if (options.profile || options.heapProfile) {
    runSample("profile", 0, options.profile, options.heapProfile);
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
  const runsDirectory = path.join(options.outputDirectory, BENCHMARK_RUNS_DIRECTORY_NAME);
  const host: HostMetadata = {
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.availableParallelism(),
    totalMemoryBytes: os.totalmem(),
    hostname: os.hostname(),
  };
  const baseline = readBaseline(options.comparePath, host);
  const targets = options.directories.map((directory, directoryIndex) =>
    collectTargetMetadata(directory, String(directoryIndex)),
  );
  for (const target of targets) {
    if (isPathWithin(runsDirectory, target.directory)) {
      throw new Error(`Benchmark target cannot be inside the runs directory: ${target.directory}`);
    }
  }
  clearBenchmarkRunArtifacts(options.outputDirectory);
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
  const reactDoctorStatus = runGit(REPOSITORY_ROOT, [
    "status",
    "--short",
    "--untracked-files=normal",
  ]);
  const result: PerformanceResult = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    reactDoctorGitSha: runGit(REPOSITORY_ROOT, ["rev-parse", "HEAD"])?.trim() || null,
    reactDoctorIsDirty: reactDoctorStatus === null ? null : reactDoctorStatus.trim().length > 0,
    host,
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

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCommanderMain(main);
