import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { aggregateRuleTimingContents } from "../../../scripts/performance/aggregate-rule-timings.ts";
import type { AnalyzedCpuProfile } from "../../../scripts/performance/analyze-cpu-profile.ts";
import { buildBenchmarkComparisons } from "../../../scripts/performance/build-benchmark-comparisons.ts";
import { buildBenchmarkEnvironment } from "../../../scripts/performance/build-benchmark-environment.ts";
import { parseOxlintSpawnLog } from "../../../scripts/performance/parse-oxlint-spawn-log.ts";
import { parsePerformanceArguments } from "../../../scripts/performance/parse-performance-arguments.ts";
import { parseProcessResourceUsage } from "../../../scripts/performance/parse-process-resource-usage.ts";
import {
  corpusTargetDirectory,
  readCorpusManifest,
  selectCorpusTargets,
} from "../../../scripts/performance/read-corpus-manifest.ts";
import { renderPerformanceMarkdown } from "../../../scripts/performance/render-performance-markdown.ts";
import {
  classifyProfileSource,
  shortenProfileUrl,
  summarizeCpuProfileFrames,
} from "../../../scripts/performance/summarize-cpu-profiles.ts";
import { summarizeScanTimeline } from "../../../scripts/performance/summarize-scan-timeline.ts";
import type {
  BenchmarkSeries,
  OxlintSpawnLog,
  PerformanceResult,
  V8ProfileCallFrame,
} from "../../../scripts/performance/types.ts";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-performance-analysis-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const SPAWN_LOG = [
  JSON.stringify({
    kind: "child",
    pid: 11,
    startedAt: 1_100,
    endedAt: 1_600,
    fileCount: 10,
    configPath: "/tmp/rd-a/oxlintrc.json",
    exitCode: 0,
    signal: null,
    stdoutBytes: 200,
    stderrBytes: 0,
    stdoutPreview: '{"diagnostics":[',
  }),
  JSON.stringify({
    kind: "child",
    pid: 12,
    startedAt: 1_200,
    endedAt: 1_500,
    fileCount: 5,
    configPath: "/tmp/rd-a/oxlintrc.json",
    exitCode: 1,
    signal: null,
    stdoutBytes: 0,
    stderrBytes: 40,
  }),
  JSON.stringify({
    kind: "child",
    pid: 13,
    startedAt: 1_700,
    endedAt: 1_900,
    fileCount: 3,
    configPath: "/tmp/rd-b/oxlintrc.json",
    exitCode: 0,
    signal: null,
    stdoutBytes: 50,
    stderrBytes: 0,
    stdoutPreview: '{"diagnostics":[',
  }),
  JSON.stringify({
    kind: "parent",
    pid: 1,
    exitedAt: 2_400,
    userMicroseconds: 1_500_000,
    systemMicroseconds: 250_000,
  }),
  "",
].join("\n");

const createSeries = (overrides: Partial<BenchmarkSeries> = {}): BenchmarkSeries => ({
  target: {
    targetId: "0",
    directory: "/tmp/app",
    label: "app",
    gitSha: "abc",
    isGitDirty: false,
    sourceFileCount: 10,
    sourceByteCount: 1_024,
    sourceFingerprint: "source-hash",
  },
  mode: "lint",
  cacheCohort: "no-cache",
  workerCount: 4,
  samples: [],
  wallMilliseconds: { minimum: 1_000, median: 1_000, maximum: 1_000, medianAbsoluteDeviation: 0 },
  cliElapsedMilliseconds: {
    minimum: 1_000,
    median: 1_000,
    maximum: 1_000,
    medianAbsoluteDeviation: 0,
  },
  maximumResidentSetBytes: null,
  filesPerSecond: 1,
  mebibytesPerSecond: 1,
  diagnosticHash: "hash",
  ...overrides,
});

const createResult = (series: BenchmarkSeries[]): PerformanceResult => ({
  schemaVersion: 1,
  generatedAt: "2026-07-09T00:00:00.000Z",
  reactDoctorGitSha: "abc",
  reactDoctorIsDirty: false,
  host: {
    platform: "linux",
    architecture: "x64",
    nodeVersion: "v22.0.0",
    v8Version: "12",
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
    ruleTimings: false,
  },
  series,
  comparisons: [],
});

const callFrame = (
  functionName: string,
  url: string,
  lineNumber: number = 1,
): V8ProfileCallFrame => ({
  functionName,
  scriptId: "1",
  url,
  lineNumber,
  columnNumber: 0,
});

const createAnalyzedProfile = (
  role: AnalyzedCpuProfile["processSummary"]["role"],
  frames: ReadonlyArray<[V8ProfileCallFrame, number]>,
): AnalyzedCpuProfile => ({
  processSummary: {
    file: `/tmp/${role}.cpuprofile`,
    role,
    sampledMicroseconds: frames.reduce((total, [, self]) => total + self, 0),
    topFrames: [],
  },
  timings: new Map(
    frames.map(([frame, self]) => [
      `${frame.functionName}|${frame.url}|${frame.lineNumber}`,
      { callFrame: frame, self, total: self },
    ]),
  ),
});

describe("performance analysis", () => {
  describe("corpus manifest", () => {
    it("reads the pinned corpus and resolves shared checkouts with subdirectories", () => {
      const targets = readCorpusManifest();
      const names = targets.map((target) => target.name);
      expect(names).toContain("tldraw");
      expect(names).toContain("tldraw-package");
      expect(names).toContain("grafana");
      const [tldraw, tldrawPackage] = selectCorpusTargets(targets, ["tldraw", "tldraw-package"]);
      expect(tldraw?.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(corpusTargetDirectory(tldraw!, "/corpus")).toBe(path.join("/corpus", "tldraw"));
      expect(corpusTargetDirectory(tldrawPackage!, "/corpus")).toBe(
        path.join("/corpus/tldraw", "packages/tldraw"),
      );
    });

    it("rejects unknown corpus names and malformed manifests", () => {
      expect(() => selectCorpusTargets(readCorpusManifest(), ["nope"])).toThrow(
        'Unknown corpus target "nope"',
      );
      const directory = createTemporaryDirectory();
      const manifestPath = path.join(directory, "corpus.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ targets: [{ name: "Bad Name", repository: "a/b", sha: "123" }] }),
      );
      expect(() => readCorpusManifest(manifestPath)).toThrow("Invalid performance corpus manifest");
    });

    it("parses --corpus and --strict", () => {
      const options = parsePerformanceArguments(["--corpus", "tldraw, grafana,tldraw", "--strict"]);
      expect(options.directories).toEqual([]);
      expect(options.corpus).toEqual(["tldraw", "grafana"]);
      expect(options.strict).toBe(true);
      expect(parsePerformanceArguments(["/tmp/app"]).corpus).toEqual([]);
      expect(parsePerformanceArguments(["/tmp/app"]).strict).toBe(false);
    });
  });

  describe("scan timeline", () => {
    it("parses the spawn log written by the core hook", () => {
      const spawnLog = parseOxlintSpawnLog(SPAWN_LOG);
      expect(spawnLog.children.map((child) => child.pid)).toEqual([11, 12, 13]);
      expect(spawnLog.parent).toMatchObject({ pid: 1, userMicroseconds: 1_500_000 });
      expect(() => parseOxlintSpawnLog('{"kind":"child"}\n')).toThrow("Invalid oxlint spawn log");
    });

    it("summarizes head, tail, concurrency, and parent CPU", () => {
      const timeline = summarizeScanTimeline({
        spawnLog: parseOxlintSpawnLog(SPAWN_LOG),
        scanStartedAt: 1_000,
        scanEndedAt: 2_500,
      });
      expect(timeline).toMatchObject({
        wallMilliseconds: 1_500,
        childProcessCount: 3,
        failedChildProcessCount: 1,
        configCount: 2,
        childFileCount: 18,
        childDurationSumMilliseconds: 1_000,
        childDurationMedianMilliseconds: 300,
        childDurationMaximumMilliseconds: 500,
        childSpanMilliseconds: 800,
        peakConcurrency: 2,
        headMilliseconds: 100,
        tailMilliseconds: 600,
        parentUserSeconds: 1.5,
        parentSystemSeconds: 0.25,
      });
      expect(timeline.averageConcurrency).toBeCloseTo(1.25);
    });

    it("handles scans that spawned no oxlint children", () => {
      const emptyLog: OxlintSpawnLog = { children: [], parent: null };
      expect(
        summarizeScanTimeline({ spawnLog: emptyLog, scanStartedAt: 0, scanEndedAt: 400 }),
      ).toMatchObject({
        childProcessCount: 0,
        headMilliseconds: 400,
        tailMilliseconds: 0,
        averageConcurrency: 0,
        parentUserSeconds: null,
      });
    });

    it("parses POSIX `time -p` output used when GNU time is unavailable", () => {
      expect(parseProcessResourceUsage("real 12.34\nuser 61.50\nsys 3.25\n")).toEqual({
        userSeconds: 61.5,
        systemSeconds: 3.25,
        maximumResidentSetBytes: null,
      });
    });

    it("threads the spawn log path into the benchmark environment", () => {
      const environment = buildBenchmarkEnvironment({
        baseEnvironment: {},
        cacheDirectory: "/tmp/cache",
        cacheCohort: "no-cache",
        workerCount: 1,
        cpuProfile: false,
        heapProfile: false,
        ruleTimings: false,
        profileDirectory: null,
        spawnLogPath: "/tmp/out/sample-0.spawn-log.jsonl",
      });
      expect(environment.REACT_DOCTOR_OXLINT_SPAWN_LOG).toBe("/tmp/out/sample-0.spawn-log.jsonl");
      expect(
        buildBenchmarkEnvironment({
          baseEnvironment: {},
          cacheDirectory: "/tmp/cache",
          cacheCohort: "no-cache",
          workerCount: 1,
          cpuProfile: false,
          heapProfile: false,
          ruleTimings: false,
          profileDirectory: null,
        }).REACT_DOCTOR_OXLINT_SPAWN_LOG,
      ).toBeUndefined();
    });
  });

  describe("rule timings", () => {
    const timingEntry = (rule: string, selector: string, milliseconds: number, calls: number) => ({
      rule,
      selector,
      timeNanoseconds: String(milliseconds * 1_000_000),
      calls,
    });

    it("ranks rules with <create> cost and top selector, and aggregates by selector", () => {
      const processA = JSON.stringify([
        timingEntry("alpha", "<create>", 40, 100),
        timingEntry("alpha", "CallExpression", 60, 5_000),
        timingEntry("beta", "CallExpression", 30, 4_000),
        timingEntry("beta", "Program", 10, 100),
      ]);
      const processB = JSON.stringify([
        timingEntry("alpha", "CallExpression", 40, 3_000),
        timingEntry("beta", "<create>", 20, 100),
      ]);
      const summary = aggregateRuleTimingContents([processA, processB]);
      expect(summary.processCount).toBe(2);
      expect(summary.totalMilliseconds).toBeCloseTo(200);
      expect(summary.createMilliseconds).toBeCloseTo(60);
      expect(summary.rules.map((row) => row.rule)).toEqual([
        "react-doctor/alpha",
        "react-doctor/beta",
      ]);
      expect(summary.rules[0]).toMatchObject({
        totalMilliseconds: 140,
        percentOfTotal: 70,
        calls: 8_100,
        createMilliseconds: 40,
        topSelector: "CallExpression",
      });
      expect(summary.rules[1]).toMatchObject({
        createMilliseconds: 20,
        topSelector: "CallExpression",
      });
      expect(summary.selectors[0]).toMatchObject({
        selector: "CallExpression",
        totalMilliseconds: 130,
        calls: 12_000,
        ruleCount: 2,
        topRule: "react-doctor/alpha",
      });
      expect(summary.selectors.map((row) => row.selector)).toEqual([
        "CallExpression",
        "<create>",
        "Program",
      ]);
    });

    it("returns an empty summary when no timings were captured", () => {
      expect(aggregateRuleTimingContents([])).toEqual({
        processCount: 0,
        totalMilliseconds: 0,
        createMilliseconds: 0,
        rules: [],
        selectors: [],
      });
    });
  });

  describe("cpu profiles", () => {
    const PLUGIN_URL = "file:///repo/node_modules/.pnpm/oxlint-plugin-react-doctor/dist/index.js";
    const OXLINT_URL = "file:///repo/node_modules/oxlint/dist/plugins.js";

    it("classifies frames into plugin, oxlint, gc, node, and native buckets", () => {
      expect(classifyProfileSource(callFrame("(garbage collector)", ""))).toBe("gc");
      expect(classifyProfileSource(callFrame("(program)", ""))).toBe("program");
      expect(classifyProfileSource(callFrame("walk", PLUGIN_URL))).toBe("plugin bundle");
      expect(classifyProfileSource(callFrame("lintFile", OXLINT_URL))).toBe("oxlint");
      expect(classifyProfileSource(callFrame("readFileSync", "node:fs"))).toBe("node internals");
      expect(classifyProfileSource(callFrame("statSync", ""))).toBe("native");
      expect(shortenProfileUrl(PLUGIN_URL)).toBe(".pnpm/oxlint-plugin-react-doctor/dist/index.js");
      expect(shortenProfileUrl("")).toBe("(native)");
      expect(shortenProfileUrl("file:///a/b/c/d/e.js")).toBe("c/d/e.js");
    });

    it("merges child profiles by function, category, and source URL", () => {
      const childA = createAnalyzedProfile("oxlint", [
        [callFrame("walk", PLUGIN_URL, 10), 300],
        [callFrame("(garbage collector)", ""), 100],
        [callFrame("lintFile", OXLINT_URL, 5), 100],
      ]);
      const childB = createAnalyzedProfile("oxlint", [
        [callFrame("walk", PLUGIN_URL, 10), 200],
        [callFrame("analyzeScopes", PLUGIN_URL, 20), 300],
      ]);
      const summary = summarizeCpuProfileFrames([childA, childB]);
      expect(summary.processCount).toBe(2);
      expect(summary.sampledMicroseconds).toBe(1_000);
      expect(summary.functions[0]).toMatchObject({ functionName: "walk", selfMicroseconds: 500 });
      expect(summary.functions[0]?.selfPercent).toBeCloseTo(50);
      expect(summary.categories[0]).toMatchObject({ source: "plugin bundle", frameCount: 2 });
      expect(summary.categories[0]?.selfPercent).toBeCloseTo(80);
      expect(summary.categories.map((category) => category.source)).toEqual([
        "plugin bundle",
        "gc",
        "oxlint",
      ]);
      expect(summary.sources[0]).toMatchObject({
        source: ".pnpm/oxlint-plugin-react-doctor/dist/index.js",
        selfMicroseconds: 800,
      });
    });
  });

  describe("comparisons", () => {
    it("reports speedup ratios and identical diagnostics", () => {
      const [comparison] = buildBenchmarkComparisons(
        [
          createSeries({
            wallMilliseconds: {
              minimum: 500,
              median: 500,
              maximum: 500,
              medianAbsoluteDeviation: 0,
            },
          }),
        ],
        [createSeries()],
      );
      expect(comparison).toMatchObject({
        speedupRatio: 2,
        diagnosticsMatch: true,
        classification: "improved",
      });
    });

    it("flags diagnostics mismatches instead of throwing when allowed", () => {
      const current = createSeries({
        diagnosticHash: "changed",
        wallMilliseconds: { minimum: 500, median: 500, maximum: 500, medianAbsoluteDeviation: 0 },
      });
      const comparisons = buildBenchmarkComparisons([current], [createSeries()], {
        allowDiagnosticMismatch: true,
      });
      expect(comparisons[0]).toMatchObject({
        diagnosticsMatch: false,
        classification: "diagnostics-mismatch",
        speedupRatio: 2,
      });
      const markdown = renderPerformanceMarkdown({ ...createResult([current]), comparisons });
      expect(markdown).toContain("DIAGNOSTICS MISMATCH");
      expect(markdown).toContain("| 2.00x | MISMATCH | diagnostics-mismatch |");
    });
  });

  describe("results markdown", () => {
    it("renders timeline, rule timing, and cpu profile sections", () => {
      const timeline = summarizeScanTimeline({
        spawnLog: parseOxlintSpawnLog(SPAWN_LOG),
        scanStartedAt: 1_000,
        scanEndedAt: 2_500,
      });
      const series = createSeries({
        timeline,
        userSeconds: { minimum: 3, median: 3.5, maximum: 4, medianAbsoluteDeviation: 0.5 },
        systemSeconds: { minimum: 0.5, median: 0.5, maximum: 0.5, medianAbsoluteDeviation: 0 },
        ruleTimings: aggregateRuleTimingContents([
          JSON.stringify([
            {
              rule: "alpha",
              selector: "<create>",
              timeNanoseconds: "40000000",
              calls: 10,
            },
          ]),
        ]),
        cpuProfile: summarizeCpuProfileFrames([
          createAnalyzedProfile("oxlint", [[callFrame("walk", "file:///x/plugin.js", 3), 100]]),
        ]),
      });
      const markdown = renderPerformanceMarkdown(createResult([series]));
      expect(markdown).toContain("## Scan timeline (median sample)");
      expect(markdown).toContain(
        "| 3.50 s | 0.50 s | 1.50 s / 0.25 s | 3 | 1 | 2 | 18 | 1000.0 ms |",
      );
      expect(markdown).toContain("| 100.0 ms | 600.0 ms |");
      expect(markdown).toContain("## Rule timings: app (lint/no-cache/workers=4)");
      expect(markdown).toContain(
        "| react-doctor/alpha | 40.0 ms | 100.0% | 10 | 40.0 ms | <create> |",
      );
      expect(markdown).toContain("### By selector");
      expect(markdown).toContain("## Child CPU profiles: app (lint/no-cache/workers=4)");
      expect(markdown).toContain("| walk | /x/plugin.js:4 | 100.0% | 100.0% |");
      expect(markdown).toContain("### Self time by source URL");
    });
  });
});
