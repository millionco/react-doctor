import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { buildBenchmarkComparisons } from "../../../scripts/performance/build-benchmark-comparisons.ts";
import { parsePerformanceArguments } from "../../../scripts/performance/parse-performance-arguments.ts";
import { readBenchmarkReport } from "../../../scripts/performance/read-benchmark-report.ts";
import { renderPerformanceMarkdown } from "../../../scripts/performance/render-performance-markdown.ts";
import { summarizeDistribution } from "../../../scripts/performance/summarize-distribution.ts";
import type { BenchmarkSeries, PerformanceResult } from "../../../scripts/performance/types.ts";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-performance-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

const createSeries = (medianMilliseconds: number): BenchmarkSeries => ({
  target: {
    directory: "/tmp/app",
    label: "app",
    gitSha: "abc",
    isGitDirty: false,
    sourceFileCount: 10,
    sourceByteCount: 1_024,
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
    expect(options.directories).toEqual([path.resolve("./packages/react-doctor"), "/tmp/example"]);
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
    expect(() => parsePerformanceArguments([".", "--cache", "unknown"])).toThrow(
      "Unknown cache cohort",
    );
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
    const reportPath = path.join(directory, "report.json");
    fs.writeFileSync(
      reportPath,
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
            scannedFileCount: 7,
            project: { sourceFileCount: 10 },
            diagnostics: [],
            score: null,
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
      }),
    );
    expect(readBenchmarkReport(reportPath)).toMatchObject({
      elapsedMilliseconds: 123,
      diagnosticCount: 0,
      scannedFileCount: 7,
    });
    const degradedReportPath = path.join(directory, "degraded.json");
    fs.writeFileSync(
      degradedReportPath,
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
            skippedChecks: ["lint"],
            project: { sourceFileCount: 10 },
            diagnostics: [],
            score: null,
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
      }),
    );
    expect(() => readBenchmarkReport(degradedReportPath)).toThrow("degraded");
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
