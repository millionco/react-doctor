import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic, InspectResult, ProjectInfo, ReactDoctorConfig } from "@react-doctor/core";
import { METRIC } from "../src/cli/utils/constants.js";
import { recordCount } from "../src/cli/utils/record-metric.js";
import {
  buildScanResultCacheKey,
  createScanResultCache,
  shouldStoreScanPayload,
  type CachedScanPayload,
} from "../src/cli/utils/scan-result-cache.js";
import {
  createScanResultCacheLifecycle,
  type CompleteScanResultCacheInput,
  type CreateScanResultCacheLifecycleInput,
  type RenderAndRecordScanInput,
  type RenderCachedProjectDetectionInput,
} from "../src/cli/utils/scan-result-cache-lifecycle.js";
import { resolveInspectOptions } from "../src/cli/utils/resolve-inspect-options.js";
import { VERSION } from "../src/cli/utils/version.js";
import { recordSentryProjectContext } from "../src/cli/utils/with-sentry-run-span.js";
import type { ReactDoctorInspectOptions, ResolvedInspectOptions } from "../src/inspect-options.js";

vi.mock("../src/cli/utils/record-metric.js", () => ({
  recordCount: vi.fn(),
}));

vi.mock("../src/cli/utils/scan-result-cache.js", () => ({
  buildScanResultCacheKey: vi.fn(),
  createScanResultCache: vi.fn(),
  shouldStoreScanPayload: vi.fn(),
}));

vi.mock("../src/cli/utils/with-sentry-run-span.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/cli/utils/with-sentry-run-span.js")>();
  return {
    ...original,
    recordSentryProjectContext: vi.fn(),
  };
});

const mockedBuildScanResultCacheKey = vi.mocked(buildScanResultCacheKey);
const mockedCreateScanResultCache = vi.mocked(createScanResultCache);
const mockedShouldStoreScanPayload = vi.mocked(shouldStoreScanPayload);
const mockedRecordCount = vi.mocked(recordCount);
const mockedRecordSentryProjectContext = vi.mocked(recordSentryProjectContext);

const projectInfo: ProjectInfo = {
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
  rule: "example",
  severity: "warning",
  message: "Example diagnostic",
  help: "Fix the example",
  line: 1,
  column: 1,
  category: "Correctness",
};

const payload: CachedScanPayload = {
  diagnostics: [diagnostic],
  score: null,
  project: projectInfo,
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
};

const replayedResult: InspectResult = {
  diagnostics: [diagnostic],
  score: null,
  skippedChecks: [],
  project: projectInfo,
  elapsedMilliseconds: 20,
  scannedFileCount: 1,
  scannedFilePaths: ["/repo/src/app.tsx"],
  analyzedFiles: ["src/app.tsx"],
  scanElapsedMilliseconds: 10,
};

const completionInput: CompleteScanResultCacheInput = {
  payload,
  scanMode: "full",
  baselineDegraded: false,
  lintCacheHitFileCount: 1,
  lintCacheTotalFileCount: 1,
  lintSidecarReplayedFileCount: 1,
  lintSidecarTotalFileCount: 1,
  deadCodeCacheHit: true,
  deadCodeSummaryCacheHits: 1,
  deadCodeSummaryCacheMisses: 0,
};

const resolveOptions = (inputOptions: ReactDoctorInspectOptions): ResolvedInspectOptions =>
  resolveInspectOptions({
    inputOptions,
    userConfig: null,
    environment: {
      isCiOrCodingAgentEnvironment: false,
      isNonInteractiveEnvironment: true,
    },
  });

const buildInput = (
  overrides: Partial<CreateScanResultCacheLifecycleInput> = {},
): CreateScanResultCacheLifecycleInput => ({
  directory: "/repo",
  options: resolveOptions({ silent: true }),
  userConfig: null,
  hasConfigOverride: false,
  configSourceDirectory: null,
  resolvedNodeBinaryPath: "/node",
  startTime: 100,
  rootSentrySpan: undefined,
  renderCachedProjectDetection: vi.fn(
    async (_input: RenderCachedProjectDetectionInput): Promise<void> => {},
  ),
  renderAndRecordScan: vi.fn(
    async (_input: RenderAndRecordScanInput): Promise<InspectResult> => replayedResult,
  ),
  recordOnboardingCompletion: vi.fn(),
  ...overrides,
});

describe("createScanResultCacheLifecycle", () => {
  const lookup = vi.fn();
  const store = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedBuildScanResultCacheKey.mockReturnValue("cache-key");
    mockedCreateScanResultCache.mockReturnValue({ lookup, store });
    mockedShouldStoreScanPayload.mockReturnValue(true);
    lookup.mockReturnValue(null);
  });

  it("builds and looks up the exact key eagerly without changing option references", () => {
    const includePaths = ["src/app.tsx"];
    const includedTags = new Set(["design"]);
    const userConfig: ReactDoctorConfig = { warnings: false };
    const options = resolveOptions({
      includePaths,
      includedTags,
      suppressRendering: true,
    });
    const input = buildInput({
      options,
      userConfig,
      hasConfigOverride: true,
      configSourceDirectory: "/repo/config",
    });

    const lifecycle = createScanResultCacheLifecycle(input);

    expect(mockedBuildScanResultCacheKey).toHaveBeenCalledTimes(1);
    const keyInput = mockedBuildScanResultCacheKey.mock.calls[0][0];
    expect(keyInput).toMatchObject({
      projectDirectory: input.directory,
      version: VERSION,
      nodeBinaryPath: input.resolvedNodeBinaryPath,
      hasConfigOverride: true,
      configSourceDirectory: "/repo/config",
    });
    expect(keyInput.userConfig).toBe(userConfig);
    expect(keyInput.policy.includePaths).toBe(includePaths);
    expect(keyInput.policy.ignoredTags).toBe(options.ignoredTags);
    expect(keyInput.policy.includedTags).toBe(includedTags);
    expect(mockedCreateScanResultCache).toHaveBeenCalledWith(input.directory);
    expect(lookup).toHaveBeenCalledWith("cache-key");
    expect(lifecycle.replay()).toBeNull();
  });

  it("replays a hit through project telemetry, rendering, scan telemetry, and onboarding in order", async () => {
    const events: string[] = [];
    lookup.mockImplementation(() => {
      events.push("lookup");
      return payload;
    });
    mockedRecordSentryProjectContext.mockImplementation(() => {
      events.push("project-context");
    });
    mockedRecordCount.mockImplementation(() => {
      events.push("project-metric");
    });
    const options = resolveOptions({
      includePaths: ["src/app.tsx"],
      baseline: { ref: "origin/main" },
      silent: true,
    });
    const renderCachedProjectDetection = vi.fn(
      async (_input: RenderCachedProjectDetectionInput): Promise<void> => {
        events.push("project-render");
      },
    );
    const renderAndRecordScan = vi.fn(
      async (_input: RenderAndRecordScanInput): Promise<InspectResult> => {
        events.push("scan-render-record");
        return replayedResult;
      },
    );
    const recordOnboardingCompletion = vi.fn(() => {
      events.push("onboarding");
    });
    const input = buildInput({
      options,
      renderCachedProjectDetection,
      renderAndRecordScan,
      recordOnboardingCompletion,
    });

    const lifecycle = createScanResultCacheLifecycle(input);
    expect(events).toEqual(["lookup"]);
    const replayPromise = lifecycle.replay();
    expect(replayPromise).not.toBeNull();
    if (replayPromise === null) return;
    await expect(replayPromise).resolves.toBe(replayedResult);

    expect(events).toEqual([
      "lookup",
      "project-context",
      "project-metric",
      "project-render",
      "scan-render-record",
      "onboarding",
    ]);
    expect(mockedRecordSentryProjectContext).toHaveBeenCalledWith(
      projectInfo,
      input.rootSentrySpan,
      { concurrentScan: options.concurrentScan },
    );
    expect(mockedRecordCount).toHaveBeenCalledWith(METRIC.projectDetected, 1);
    expect(renderCachedProjectDetection).toHaveBeenCalledWith({
      payload,
      options,
      userConfig: input.userConfig,
      isDiffMode: true,
    });
    expect(renderAndRecordScan).toHaveBeenCalledWith({
      payload,
      options,
      userConfig: input.userConfig,
      hasCustomConfig: false,
      startTime: input.startTime,
      rootSentrySpan: input.rootSentrySpan,
      scanMode: "diff",
      baselineDegraded: true,
      wholeRepoCacheHit: true,
    });
    expect(recordOnboardingCompletion).toHaveBeenCalledWith(options);
  });

  it("keeps cache-hit rendering errors identical and does not run later stages", async () => {
    const renderError = new Error("render failed");
    lookup.mockReturnValue(payload);
    const renderCachedProjectDetection = vi.fn(
      async (_input: RenderCachedProjectDetectionInput): Promise<void> => {
        throw renderError;
      },
    );
    const renderAndRecordScan = vi.fn(
      async (_input: RenderAndRecordScanInput): Promise<InspectResult> => replayedResult,
    );
    const recordOnboardingCompletion = vi.fn();
    const lifecycle = createScanResultCacheLifecycle(
      buildInput({
        renderCachedProjectDetection,
        renderAndRecordScan,
        recordOnboardingCompletion,
      }),
    );

    const replayPromise = lifecycle.replay();
    expect(replayPromise).not.toBeNull();
    if (replayPromise === null) return;
    await expect(replayPromise).rejects.toBe(renderError);
    expect(renderAndRecordScan).not.toHaveBeenCalled();
    expect(recordOnboardingCompletion).not.toHaveBeenCalled();
  });

  it("stores eligible payloads before cold rendering and onboarding", async () => {
    const events: string[] = [];
    mockedShouldStoreScanPayload.mockImplementation(() => {
      events.push("eligibility");
      return true;
    });
    store.mockImplementation(() => {
      events.push("store");
    });
    const renderAndRecordScan = vi.fn(
      async (_input: RenderAndRecordScanInput): Promise<InspectResult> => {
        events.push("scan-render-record");
        return replayedResult;
      },
    );
    const recordOnboardingCompletion = vi.fn(() => {
      events.push("onboarding");
    });
    const input = buildInput({ renderAndRecordScan, recordOnboardingCompletion });
    const lifecycle = createScanResultCacheLifecycle(input);

    await expect(lifecycle.complete(completionInput)).resolves.toBe(replayedResult);
    expect(mockedShouldStoreScanPayload).toHaveBeenCalledWith(payload);
    expect(store).toHaveBeenCalledWith("cache-key", payload);
    expect(events).toEqual(["eligibility", "store", "scan-render-record", "onboarding"]);
    expect(renderAndRecordScan).toHaveBeenCalledWith({
      payload,
      options: input.options,
      userConfig: null,
      hasCustomConfig: false,
      startTime: 100,
      rootSentrySpan: undefined,
      scanMode: "full",
      baselineDegraded: false,
      wholeRepoCacheHit: false,
      lintCacheHitFileCount: 1,
      lintCacheTotalFileCount: 1,
      lintSidecarReplayedFileCount: 1,
      lintSidecarTotalFileCount: 1,
      deadCodeCacheHit: true,
      deadCodeSummaryCacheHits: 1,
      deadCodeSummaryCacheMisses: 0,
    });

    store.mockClear();
    await lifecycle.complete({ ...completionInput, baselineDegraded: true });
    expect(mockedShouldStoreScanPayload).toHaveBeenCalledWith(payload);
    expect(store).not.toHaveBeenCalled();

    mockedShouldStoreScanPayload.mockReturnValue(false);
    await lifecycle.complete(completionInput);
    expect(store).not.toHaveBeenCalled();
  });

  it("bypasses cache creation, lookup, eligibility, and writes when keying returns null", async () => {
    mockedBuildScanResultCacheKey.mockReturnValue(null);
    const lifecycle = createScanResultCacheLifecycle(buildInput());

    expect(mockedCreateScanResultCache).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(lifecycle.replay()).toBeNull();
    await expect(lifecycle.complete(completionInput)).resolves.toBe(replayedResult);
    expect(mockedShouldStoreScanPayload).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  });
});
