import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeCpuProfiles } from "../../../scripts/performance/analyze-cpu-profile.ts";
import { analyzeHeapProfiles } from "../../../scripts/performance/analyze-heap-profile.ts";
import { buildBenchmarkComparisons } from "../../../scripts/performance/build-benchmark-comparisons.ts";
import { buildBenchmarkEnvironment } from "../../../scripts/performance/build-benchmark-environment.ts";
import type { BuildBenchmarkEnvironmentInput } from "../../../scripts/performance/build-benchmark-environment.ts";
import { clearBenchmarkRunArtifacts } from "../../../scripts/performance/clear-benchmark-run-artifacts.ts";
import { createStressProject } from "../../../scripts/performance/create-stress-project.ts";
import { parsePerformanceArguments } from "../../../scripts/performance/parse-performance-arguments.ts";
import { parseProcessResourceUsage } from "../../../scripts/performance/parse-process-resource-usage.ts";
import { parseStressPerformanceArguments } from "../../../scripts/performance/parse-stress-performance-arguments.ts";
import { readBenchmarkReport } from "../../../scripts/performance/read-benchmark-report.ts";
import { renderPerformanceMarkdown } from "../../../scripts/performance/render-performance-markdown.ts";
import { runPerformance } from "../../../scripts/performance/run-performance.ts";
import { runStressPerformance } from "../../../scripts/performance/run-stress-performance.ts";
import { summarizeDistribution } from "../../../scripts/performance/summarize-distribution.ts";
import type { BenchmarkSeries, PerformanceResult } from "../../../scripts/performance/types.ts";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
const builtCliPath = path.join(REPOSITORY_ROOT, "packages/react-doctor/dist/cli.js");
const hasBuiltCli = fs.existsSync(builtCliPath);
const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-performance-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

const createSeries = (
  medianMilliseconds: number,
  targetOverrides: Partial<BenchmarkSeries["target"]> = {},
): BenchmarkSeries => ({
  target: {
    targetId: "0",
    directory: "/tmp/app",
    label: "app",
    gitSha: "abc",
    isGitDirty: false,
    sourceFileCount: 10,
    sourceByteCount: 1_024,
    sourceFingerprint: "source-hash",
    ...targetOverrides,
  },
  mode: "lint",
  cacheCohort: "no-cache",
  workerCount: 4,
  samples: [],
  wallMilliseconds: {
    minimum: medianMilliseconds,
    median: medianMilliseconds,
    maximum: medianMilliseconds,
    medianAbsoluteDeviation: 0,
  },
  cliElapsedMilliseconds: {
    minimum: medianMilliseconds,
    median: medianMilliseconds,
    maximum: medianMilliseconds,
    medianAbsoluteDeviation: 0,
  },
  maximumResidentSetBytes: null,
  filesPerSecond: 1,
  mebibytesPerSecond: 1,
  diagnosticHash: "hash",
});

const createResult = (series: BenchmarkSeries[]): PerformanceResult => ({
  schemaVersion: 1,
  generatedAt: "2026-07-09T00:00:00.000Z",
  reactDoctorGitSha: "abc",
  reactDoctorIsDirty: false,
  host: {
    platform: "darwin",
    architecture: "arm64",
    nodeVersion: "v24.0.0",
    v8Version: "13.6",
    cpuModel: "Test CPU",
    cpuCount: 8,
    totalMemoryBytes: 16_000,
    hostname: "test",
  },
  options: {
    samples: 1,
    warmups: 0,
    workerCounts: [4],
    modes: ["lint"],
    cacheCohorts: ["no-cache"],
    outputDirectory: "/tmp/output",
    cliPath: "/tmp/react-doctor.js",
    profile: false,
    heapProfile: false,
  },
  series,
  comparisons: [],
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("performance harness", () => {
  it("parses arbitrary directories and benchmark dimensions", () => {
    const options = parsePerformanceArguments([
      "./packages/react-doctor",
      "/tmp/example",
      "--samples",
      "3",
      "--warmups",
      "0",
      "--workers",
      "1,4,auto",
      "--mode",
      "both",
      "--cache",
      "all",
      "--profile",
      "--heap-profile",
    ]);
    expect(options.directories).toEqual([
      path.resolve("./packages/react-doctor"),
      path.resolve("/tmp/example"),
    ]);
    expect(options.samples).toBe(3);
    expect(options.warmups).toBe(0);
    expect(options.workerCounts).toEqual([1, 4, "auto"]);
    expect(options.modes).toEqual(["lint", "full"]);
    expect(options.cacheCohorts).toEqual(["no-cache", "cold", "hot"]);
    expect(options.profile).toBe(true);
    expect(options.heapProfile).toBe(true);
  });

  it("rejects invalid arguments", () => {
    expect(() => parsePerformanceArguments([])).toThrow();
    expect(() => parsePerformanceArguments([".", "--samples", "0"])).toThrow("--samples");
    expect(() => parsePerformanceArguments([".", "--samples", "3oops"])).toThrow("--samples");
    expect(() => parsePerformanceArguments([".", "--workers", "1.5"])).toThrow("--workers");
    expect(() => parsePerformanceArguments([".", "--cache", "unknown"])).toThrow(
      "Unknown cache cohort",
    );
    expect(() => parseStressPerformanceArguments(["--files", "1e3"])).toThrow("--files");
  });

  it("isolates cache cohorts and supports profile paths with spaces", () => {
    const profileDirectory = path.join(createTemporaryDirectory(), "profiles with spaces");
    fs.mkdirSync(profileDirectory);
    const sharedInput: Omit<BuildBenchmarkEnvironmentInput, "cacheCohort"> = {
      baseEnvironment: {
        NODE_OPTIONS: "--trace-warnings",
        NODE_DISABLE_COMPILE_CACHE: "1",
        REACT_DOCTOR_LINT_BATCH_ORDERING: "arrival",
        REACT_DOCTOR_NO_CACHE: "1",
        REACT_DOCTOR_NO_FILE_CACHE: "1",
      },
      cacheDirectory: path.join(createTemporaryDirectory(), "cache"),
      workerCount: "auto",
      cpuProfile: true,
      heapProfile: true,
      profileDirectory,
    };
    const coldEnvironment = buildBenchmarkEnvironment({
      ...sharedInput,
      cacheCohort: "cold",
    });
    const noCacheEnvironment = buildBenchmarkEnvironment({
      ...sharedInput,
      cacheCohort: "no-cache",
    });

    expect(coldEnvironment.REACT_DOCTOR_NO_CACHE).toBeUndefined();
    expect(noCacheEnvironment.REACT_DOCTOR_NO_CACHE).toBe("1");
    expect(coldEnvironment.NODE_OPTIONS ?? "").not.toContain("--trace-warnings");
    expect(coldEnvironment.NODE_DISABLE_COMPILE_CACHE).toBeUndefined();
    expect(coldEnvironment.REACT_DOCTOR_LINT_BATCH_ORDERING).toBeUndefined();
    expect(coldEnvironment.REACT_DOCTOR_NO_FILE_CACHE).toBeUndefined();
    expect(coldEnvironment.NODE_OPTIONS?.split(" ").includes("--cpu-prof")).toBe(
      process.allowedNodeEnvironmentFlags.has("--cpu-prof"),
    );
    if (process.allowedNodeEnvironmentFlags.has("--cpu-prof-dir")) {
      expect(coldEnvironment.NODE_OPTIONS).toContain(
        `--cpu-prof-dir=${JSON.stringify(profileDirectory)}`,
      );
    }
    if (process.allowedNodeEnvironmentFlags.has("--heap-prof-dir")) {
      expect(coldEnvironment.NODE_OPTIONS).toContain(
        `--heap-prof-dir=${JSON.stringify(profileDirectory)}`,
      );
    }
    if (coldEnvironment.NODE_OPTIONS !== undefined) {
      const environmentProfileProbe = spawnSync(process.execPath, ["-e", ""], {
        encoding: "utf8",
        env: coldEnvironment,
      });
      expect(environmentProfileProbe.status, environmentProfileProbe.stderr).toBe(0);
      const areFlagsAllowed = (...flagNames: string[]): boolean =>
        flagNames.every((flagName) => process.allowedNodeEnvironmentFlags.has(flagName));
      const profileFilenames = fs.readdirSync(profileDirectory);
      expect(profileFilenames.some((filename) => filename.endsWith(".cpuprofile"))).toBe(
        areFlagsAllowed("--cpu-prof", "--cpu-prof-dir"),
      );
      expect(profileFilenames.some((filename) => filename.endsWith(".heapprofile"))).toBe(
        areFlagsAllowed("--heap-prof", "--heap-prof-dir"),
      );
    }
  });

  it("preserves zero-valued process resource measurements", () => {
    expect(
      parseProcessResourceUsage("0.01 real 0.00 user 0.00 sys\n0 maximum resident set size"),
    ).toEqual({
      userSeconds: 0,
      systemSeconds: 0,
      maximumResidentSetBytes: 0,
    });
    expect(
      parseProcessResourceUsage(
        "User time (seconds): 0.00\nSystem time (seconds): 0.00\nMaximum resident set size (kbytes): 0",
      ),
    ).toEqual({
      userSeconds: 0,
      systemSeconds: 0,
      maximumResidentSetBytes: 0,
    });
  });

  it("parses stress-project dimensions and benchmark options", () => {
    const options = parseStressPerformanceArguments([
      "--files",
      "12",
      "--components-per-file",
      "3",
      "--samples",
      "2",
      "--warmups",
      "0",
      "--workers",
      "1,auto",
      "--profile",
    ]);

    expect(options.files).toBe(12);
    expect(options.componentsPerFile).toBe(3);
    expect(options.samples).toBe(2);
    expect(options.warmups).toBe(0);
    expect(options.workers).toBe("1,auto");
    expect(options.profile).toBe(true);
    expect(parseStressPerformanceArguments([]).cache).toBe("cold");
  });

  it("generates a deterministic stress project", () => {
    const directory = createTemporaryDirectory();
    const stressProject = createStressProject({
      directory,
      fileCount: 3,
      componentsPerFileCount: 2,
    });
    const componentPath = path.join(directory, "src", "component-00000.tsx");
    const firstSource = fs.readFileSync(componentPath, "utf8");

    expect(stressProject.generatedSourceFileCount).toBe(5);
    expect(stressProject.componentCount).toBe(6);
    expect(firstSource).toContain("StressComponent00000_0");
    expect(firstSource).toContain("StressComponent00000_1");

    createStressProject({
      directory,
      fileCount: 3,
      componentsPerFileCount: 2,
    });
    expect(fs.readFileSync(componentPath, "utf8")).toBe(firstSource);
  });

  it("refuses to replace unmarked stress directories", () => {
    const directory = createTemporaryDirectory();
    const projectDirectory = path.join(directory, "existing-project");
    const sentinelPath = path.join(projectDirectory, "keep.txt");
    fs.mkdirSync(projectDirectory);
    fs.writeFileSync(sentinelPath, "keep");

    expect(() =>
      createStressProject({
        directory: projectDirectory,
        fileCount: 1,
        componentsPerFileCount: 1,
      }),
    ).toThrow("unmarked");
    expect(fs.readFileSync(sentinelPath, "utf8")).toBe("keep");
  });

  it("refuses stress project paths that contain the working directory", () => {
    expect(() =>
      createStressProject({
        directory: path.dirname(process.cwd()),
        fileCount: 1,
        componentsPerFileCount: 1,
      }),
    ).toThrow("working directory");
  });

  it("refuses to replace unmarked benchmark runs directories", () => {
    const outputDirectory = createTemporaryDirectory();
    const runsDirectory = path.join(outputDirectory, "runs");
    const sentinelPath = path.join(runsDirectory, "keep.txt");
    fs.mkdirSync(runsDirectory);
    fs.writeFileSync(sentinelPath, "keep");

    expect(() => clearBenchmarkRunArtifacts(outputDirectory)).toThrow("unmarked");
    expect(fs.readFileSync(sentinelPath, "utf8")).toBe("keep");
  });

  it("refuses to replace unmarked benchmark result files", () => {
    const outputDirectory = createTemporaryDirectory();
    const resultPath = path.join(outputDirectory, "results.json");
    fs.writeFileSync(resultPath, "keep");

    expect(() => clearBenchmarkRunArtifacts(outputDirectory)).toThrow("unmarked benchmark output");
    expect(fs.readFileSync(resultPath, "utf8")).toBe("keep");
  });

  it("clears only marked benchmark run artifacts", () => {
    const outputDirectory = createTemporaryDirectory();
    clearBenchmarkRunArtifacts(outputDirectory);
    const staleProfilePath = path.join(outputDirectory, "runs", "stale.cpuprofile");
    const staleResultPath = path.join(outputDirectory, "results.json");
    fs.writeFileSync(staleProfilePath, "{}");
    fs.writeFileSync(staleResultPath, "{}");

    clearBenchmarkRunArtifacts(outputDirectory);

    expect(fs.existsSync(staleProfilePath)).toBe(false);
    expect(fs.existsSync(staleResultPath)).toBe(false);
  });

  it("rejects overlapping stress project and benchmark runs directories before replacement", () => {
    const directory = createTemporaryDirectory();
    const outputDirectory = path.join(directory, "results");
    const projectDirectory = path.join(outputDirectory, "runs", "project");
    createStressProject({
      directory: projectDirectory,
      fileCount: 1,
      componentsPerFileCount: 1,
    });
    const sentinelPath = path.join(projectDirectory, "keep.txt");
    fs.writeFileSync(sentinelPath, "keep");

    expect(() =>
      runStressPerformance([
        "--project",
        projectDirectory,
        "--out",
        outputDirectory,
        "--samples",
        "1",
        "--warmups",
        "0",
      ]),
    ).toThrow("cannot overlap");
    expect(fs.readFileSync(sentinelPath, "utf8")).toBe("keep");
  });

  it("validates stress benchmark dimensions before replacing the generated project", () => {
    const directory = createTemporaryDirectory();
    const projectDirectory = path.join(directory, "stress-project");
    const outputDirectory = path.join(directory, "results");
    createStressProject({
      directory: projectDirectory,
      fileCount: 1,
      componentsPerFileCount: 1,
    });
    const sentinelPath = path.join(projectDirectory, "keep.txt");
    fs.writeFileSync(sentinelPath, "keep");

    expect(() =>
      runStressPerformance([
        "--project",
        projectDirectory,
        "--out",
        outputDirectory,
        "--cache",
        "typo",
      ]),
    ).toThrow("Unknown cache cohort");
    expect(fs.readFileSync(sentinelPath, "utf8")).toBe("keep");
  });

  describe.skipIf(!hasBuiltCli)("with the built CLI", () => {
    it("runs the benchmark against a generated stress project with stable diagnostics", () => {
      const directory = createTemporaryDirectory();
      const projectDirectory = path.join(directory, "project");
      const outputDirectory = path.join(directory, "results");
      const stressProject = createStressProject({
        directory: projectDirectory,
        fileCount: 4,
        componentsPerFileCount: 1,
      });
      const result = runPerformance({
        directories: [projectDirectory],
        samples: 2,
        warmups: 0,
        workerCounts: [1],
        modes: ["lint"],
        cacheCohorts: ["no-cache"],
        outputDirectory,
        comparePath: null,
        cliPath: builtCliPath,
        profile: false,
        heapProfile: false,
      });

      expect(result.series).toHaveLength(1);
      expect(result.series[0]?.samples).toHaveLength(2);
      expect(result.series[0]?.diagnosticHash).toHaveLength(64);
      expect(result.series[0]?.samples[0]?.diagnosticCount).toBeGreaterThan(0);
      expect(result.series[0]?.samples[1]?.diagnosticHash).toBe(
        result.series[0]?.samples[0]?.diagnosticHash,
      );
      expect(result.series[0]?.samples[0]?.scannedFileCount).toBe(
        stressProject.generatedSourceFileCount,
      );
    });

    it("captures and aggregates profiles across the benchmark process tree", () => {
      const directory = createTemporaryDirectory();
      const projectDirectory = path.join(directory, "project");
      const outputDirectory = path.join(directory, "profile results");
      createStressProject({
        directory: projectDirectory,
        fileCount: 1,
        componentsPerFileCount: 1,
      });
      runPerformance({
        directories: [projectDirectory],
        samples: 1,
        warmups: 0,
        workerCounts: [1],
        modes: ["full"],
        cacheCohorts: ["no-cache"],
        outputDirectory,
        comparePath: null,
        cliPath: builtCliPath,
        profile: true,
        heapProfile: true,
      });

      const cpuAnalysis = analyzeCpuProfiles(outputDirectory);
      const heapAnalysis = analyzeHeapProfiles(outputDirectory);
      const cpuProcessRoles = new Set(
        cpuAnalysis.processes.map((processSummary) => processSummary.role),
      );
      expect(cpuProcessRoles).toContain("react-doctor");
      expect(cpuProcessRoles).toContain("oxlint");
      if (process.allowedNodeEnvironmentFlags.has("--cpu-prof")) {
        expect(cpuProcessRoles).toContain("dead-code");
      } else {
        expect(cpuProcessRoles.size).toBeGreaterThanOrEqual(2);
      }
      expect(heapAnalysis.processes.length).toBeGreaterThanOrEqual(
        process.allowedNodeEnvironmentFlags.has("--heap-prof") ? 3 : 2,
      );
    });
  });

  it("summarizes distributions with a robust median and MAD", () => {
    expect(summarizeDistribution([1, 2, 3, 4, 100])).toEqual({
      minimum: 1,
      median: 3,
      maximum: 100,
      medianAbsoluteDeviation: 1,
    });
  });

  it("validates reports and hashes diagnostics", () => {
    const directory = createTemporaryDirectory();
    const buildReportJson = (projectOverrides: Record<string, unknown>): string =>
      JSON.stringify({
        schemaVersion: 1,
        version: "0.0.0",
        ok: true,
        directory,
        mode: "full",
        diff: null,
        elapsedMilliseconds: 123,
        diagnostics: [],
        projects: [
          {
            directory,
            elapsedMilliseconds: 120,
            skippedChecks: [],
            project: { sourceFileCount: 10 },
            diagnostics: [],
            score: null,
            ...projectOverrides,
          },
        ],
        summary: {
          errorCount: 0,
          warningCount: 0,
          affectedFileCount: 0,
          totalDiagnosticCount: 0,
          score: null,
          scoreLabel: null,
        },
        error: null,
      });
    const reportPath = path.join(directory, "report.json");
    fs.writeFileSync(reportPath, buildReportJson({ scannedFileCount: 7 }));
    expect(readBenchmarkReport({ reportPath, targetDirectory: directory })).toMatchObject({
      elapsedMilliseconds: 123,
      diagnosticCount: 0,
      scannedFileCount: 7,
    });
    expect(() =>
      readBenchmarkReport({ reportPath, targetDirectory: path.join(directory, "other") }),
    ).toThrow("target mismatch");
    const degradedReportPath = path.join(directory, "degraded.json");
    fs.writeFileSync(degradedReportPath, buildReportJson({ skippedChecks: ["lint"] }));
    expect(() =>
      readBenchmarkReport({ reportPath: degradedReportPath, targetDirectory: directory }),
    ).toThrow("degraded");
  });

  it("classifies material regressions and renders the summary", () => {
    const baselineSeries = createSeries(1_000);
    const currentSeries = createSeries(1_300);
    const comparisons = buildBenchmarkComparisons([currentSeries], [baselineSeries]);
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]?.classification).toBe("regressed");
    const markdown = renderPerformanceMarkdown({
      ...createResult([currentSeries]),
      comparisons,
    });
    expect(markdown).toContain("React Doctor performance results");
    expect(markdown).toContain("regressed");
    expect(markdown).toContain("1300.0 ms");
  });

  it("matches comparison targets across checkout paths", () => {
    const baselineSeries = createSeries(1_000, {
      directory: "/tmp/baseline/app",
      label: undefined,
    });
    const currentSeries = createSeries(900, { directory: "/tmp/current/app", label: undefined });

    expect(buildBenchmarkComparisons([currentSeries], [baselineSeries])).toHaveLength(1);
  });

  it("rejects comparisons with no matching baseline series", () => {
    const baselineSeries = createSeries(1_000, { label: "other-app" });

    expect(() => buildBenchmarkComparisons([createSeries(900)], [baselineSeries])).toThrow(
      "no matching series",
    );
  });

  it("rejects comparisons between different source workloads", () => {
    const currentSeries = createSeries(900, { sourceFingerprint: "changed-source" });

    expect(() => buildBenchmarkComparisons([currentSeries], [createSeries(1_000)])).toThrow(
      "no matching series",
    );
  });

  it("rejects comparisons when diagnostic output changes", () => {
    const baselineSeries = createSeries(1_000);
    const currentSeries = {
      ...createSeries(900),
      diagnosticHash: "changed",
    };
    expect(() => buildBenchmarkComparisons([currentSeries], [baselineSeries])).toThrow(
      "Diagnostic output changed",
    );
  });
});
