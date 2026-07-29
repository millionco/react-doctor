import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic, ProjectInfo, ScoreResult } from "@react-doctor/core";
import { recordRunEvent } from "../src/cli/utils/build-run-event.js";
import { computeProjectedScore } from "../src/cli/utils/compute-score-projection.js";
import { recordScanMetrics } from "../src/cli/utils/record-scan-metrics.js";
import { printDiagnostics } from "../src/cli/utils/render-diagnostics.js";
import {
  renderAndRecordScan,
  renderCachedProjectDetection,
  type RenderAndRecordScanInput,
} from "../src/cli/utils/render-inspect-result.js";
import { printProjectDetection } from "../src/cli/utils/render-project-detection.js";
import {
  printDiagnosticsDump,
  printFooter,
  printSummary,
} from "../src/cli/utils/render-summary.js";
import type { CachedScanPayload } from "../src/cli/utils/scan-result-cache.js";
import { resolveInspectOptions } from "../src/cli/utils/resolve-inspect-options.js";
import type { ReactDoctorInspectOptions, ResolvedInspectOptions } from "../src/inspect-options.js";

vi.mock("../src/cli/utils/build-run-event.js", () => ({
  recordRunEvent: vi.fn(),
}));

vi.mock("../src/cli/utils/compute-score-projection.js", () => ({
  computeProjectedScore: vi.fn(async () => null),
}));

vi.mock("../src/cli/utils/onboarding-pacing.js", () => ({
  canAnimateOnboarding: vi.fn(() => false),
  onboardingSectionPause: vi.fn(() => Effect.void),
}));

vi.mock("../src/cli/utils/record-scan-metrics.js", () => ({
  recordScanMetrics: vi.fn(),
}));

vi.mock("../src/cli/utils/render-diagnostics.js", () => ({
  printDiagnostics: vi.fn(() => Effect.void),
}));

vi.mock("../src/cli/utils/render-project-detection.js", () => ({
  printProjectDetection: vi.fn(() => Effect.void),
}));

vi.mock("../src/cli/utils/render-summary.js", () => ({
  printDiagnosticsDump: vi.fn(() => Effect.void),
  printFooter: vi.fn(() => Effect.void),
  printSummary: vi.fn(() => Effect.void),
}));

const mockedComputeProjectedScore = vi.mocked(computeProjectedScore);
const mockedPrintDiagnostics = vi.mocked(printDiagnostics);
const mockedPrintDiagnosticsDump = vi.mocked(printDiagnosticsDump);
const mockedPrintFooter = vi.mocked(printFooter);
const mockedPrintProjectDetection = vi.mocked(printProjectDetection);
const mockedPrintSummary = vi.mocked(printSummary);
const mockedRecordRunEvent = vi.mocked(recordRunEvent);
const mockedRecordScanMetrics = vi.mocked(recordScanMetrics);

const project: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "example",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "unknown",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasI18nLibrary: false,
  tanstackQueryVersion: null,
  mobxVersion: null,
  styledComponentsVersion: null,
  preactVersion: null,
  preactMajorVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  sourceFileCount: 1,
};

const diagnostic: Diagnostic = {
  filePath: "/repo/src/app.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "warning",
  message: "Avoid array indexes as keys",
  help: "Use a stable key",
  line: 1,
  column: 1,
  category: "Correctness",
};

const designDiagnostic: Diagnostic = {
  ...diagnostic,
  rule: "no-gradient-text",
  category: "Design",
};

const score: ScoreResult = { score: 88, label: "Great" };

const buildPayload = (overrides: Partial<CachedScanPayload> = {}): CachedScanPayload => ({
  diagnostics: [diagnostic],
  score,
  project,
  userConfig: null,
  didLintFail: false,
  lintFailureReason: null,
  lintPartialFailures: [],
  didDeadCodeFail: false,
  deadCodeFailureReason: null,
  deadCodeOverlapped: false,
  directory: "/repo",
  scannedFileCount: 1,
  scannedFilePaths: ["/repo/src/app.tsx"],
  analyzedFiles: ["src/app.tsx"],
  scanElapsedMilliseconds: 10,
  scanConcurrency: 2,
  baselineDelta: undefined,
  lintFailureReasonKind: null,
  supplyChainOverlapTimedOut: false,
  securityScanFailed: false,
  suppressedRuleCounts: [],
  ...overrides,
});

const resolveOptions = (inputOptions: ReactDoctorInspectOptions): ResolvedInspectOptions =>
  resolveInspectOptions({
    inputOptions,
    userConfig: null,
    environment: {
      isCiOrCodingAgentEnvironment: false,
      isNonInteractiveEnvironment: false,
    },
  });

const buildInput = (
  options: ResolvedInspectOptions,
  payload: CachedScanPayload = buildPayload(),
): RenderAndRecordScanInput => ({
  payload,
  options,
  userConfig: null,
  hasCustomConfig: false,
  startTime: performance.now(),
  rootSentrySpan: undefined,
  scanMode: "full",
  baselineDegraded: false,
  wholeRepoCacheHit: false,
});

describe("render inspect result lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedComputeProjectedScore.mockResolvedValue(null);
  });

  it("returns the same payload references without rendering when rendering is suppressed", async () => {
    const payload = buildPayload();
    const events: string[] = [];
    mockedRecordScanMetrics.mockImplementation(() => {
      events.push("metrics");
    });
    mockedRecordRunEvent.mockImplementation(() => {
      events.push("run-event");
    });

    const result = await renderAndRecordScan(
      buildInput(resolveOptions({ suppressRendering: true }), payload),
    );

    expect(result.diagnostics).toEqual(payload.diagnostics);
    expect(result.diagnostics).not.toBe(payload.diagnostics);
    expect(result.score).toBe(payload.score);
    expect(result.project).toBe(payload.project);
    expect(result.scannedFilePaths).toBe(payload.scannedFilePaths);
    expect(result.analyzedFiles).toBe(payload.analyzedFiles);
    expect(mockedPrintDiagnostics).not.toHaveBeenCalled();
    expect(mockedPrintSummary).not.toHaveBeenCalled();
    expect(mockedPrintFooter).not.toHaveBeenCalled();
    expect(events).toEqual(["metrics", "run-event"]);
    expect(mockedRecordRunEvent.mock.calls[0][1].result).toBe(result);
  });

  it("keeps score-only stdout machine-clean and writes no-score prose to stderr", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderAndRecordScan(
      buildInput(resolveOptions({ scoreOnly: true, outputDirectory: "/dump" })),
    );

    expect(mockedPrintDiagnosticsDump).toHaveBeenCalledWith([diagnostic], "/dump", false, "stderr");
    expect(log).toHaveBeenCalledWith("88");
    expect(error).not.toHaveBeenCalled();

    log.mockClear();
    mockedPrintDiagnosticsDump.mockClear();
    await renderAndRecordScan(
      buildInput(resolveOptions({ scoreOnly: true }), buildPayload({ score: null })),
    );

    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Score unavailable"));
  });

  it.each([
    {
      name: "ordinary",
      payload: buildPayload({ diagnostics: [], score: null }),
      options: resolveOptions({}),
      expected: "No issues found!",
    },
    {
      name: "category-filtered",
      payload: buildPayload({ score: null }),
      options: resolveOptions({ categoryFilters: ["Security"] }),
      expected: "No issues found in category Security!",
    },
    {
      name: "surface-demoted",
      payload: buildPayload({ diagnostics: [designDiagnostic], score: null }),
      options: resolveOptions({ outputSurface: "prComment" }),
      expected: "1 demoted from the prComment surface",
    },
    {
      name: "skipped",
      payload: buildPayload({
        diagnostics: [],
        score: null,
        didLintFail: true,
        lintFailureReason: "lint crashed",
      }),
      options: resolveOptions({}),
      expected: "results are incomplete",
    },
  ])("renders the $name no-findings state", async ({ payload, options, expected }) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await renderAndRecordScan(buildInput(options, payload));

    const output = [...log.mock.calls, ...warn.mock.calls].flat().join("\n");
    expect(output).toContain(expected);
    if (payload.didLintFail) {
      expect(result.skippedChecks).toContain("lint");
      expect(output).toContain("Score not shown");
    }
  });

  it("renders findings, summary, and footer in order before recording telemetry", async () => {
    const events: string[] = [];
    mockedPrintDiagnostics.mockImplementation(() =>
      Effect.sync(() => {
        events.push("diagnostics");
      }),
    );
    mockedPrintSummary.mockImplementation(() =>
      Effect.sync(() => {
        events.push("summary");
      }),
    );
    mockedPrintFooter.mockImplementation(() =>
      Effect.sync(() => {
        events.push("footer");
      }),
    );
    mockedRecordScanMetrics.mockImplementation(() => {
      events.push("metrics");
    });
    mockedRecordRunEvent.mockImplementation(() => {
      events.push("run-event");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await renderAndRecordScan(buildInput(resolveOptions({})));

    expect(events).toEqual(["diagnostics", "summary", "footer", "metrics", "run-event"]);
  });

  it("does not wrap metric failures and does not record a run event afterward", async () => {
    const failure = new Error("metric failure");
    mockedRecordScanMetrics.mockImplementation(() => {
      throw failure;
    });

    await expect(
      renderAndRecordScan(buildInput(resolveOptions({ suppressRendering: true }))),
    ).rejects.toBe(failure);
    expect(mockedRecordRunEvent).not.toHaveBeenCalled();
  });

  it("preserves run-event failure identity after recording metrics", async () => {
    const failure = new Error("run-event failure");
    mockedRecordScanMetrics.mockImplementation(() => {});
    mockedRecordRunEvent.mockImplementation(() => {
      throw failure;
    });

    await expect(
      renderAndRecordScan(buildInput(resolveOptions({ suppressRendering: true }))),
    ).rejects.toBe(failure);
    expect(mockedRecordScanMetrics).toHaveBeenCalledOnce();
  });

  it("preserves render failure identity and skips telemetry", async () => {
    const failure = new Error("render failure");
    mockedPrintDiagnostics.mockImplementation(() => Effect.fail(failure));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(renderAndRecordScan(buildInput(resolveOptions({})))).rejects.toBe(failure);
    expect(mockedRecordScanMetrics).not.toHaveBeenCalled();
    expect(mockedRecordRunEvent).not.toHaveBeenCalled();
  });

  it("renders cached project detection only for visible non-score output", async () => {
    const payload = buildPayload();
    const options = resolveOptions({});

    await renderCachedProjectDetection({
      payload,
      options,
      userConfig: null,
      isDiffMode: true,
    });

    expect(mockedPrintProjectDetection).toHaveBeenCalledWith({
      projectInfo: payload.project,
      userConfig: null,
      isDiffMode: true,
      includePaths: options.includePaths,
      lintSourceFileCount: payload.scannedFileCount,
    });

    mockedPrintProjectDetection.mockClear();
    await renderCachedProjectDetection({
      payload,
      options: resolveOptions({ scoreOnly: true }),
      userConfig: null,
      isDiffMode: false,
    });
    await renderCachedProjectDetection({
      payload,
      options: resolveOptions({ suppressRendering: true }),
      userConfig: null,
      isDiffMode: false,
    });
    expect(mockedPrintProjectDetection).not.toHaveBeenCalled();
  });
});
