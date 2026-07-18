import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic, InspectResult, ProjectInfo, ReactDoctorConfig } from "@react-doctor/core";
import { computeProjectedScore } from "../src/cli/utils/compute-score-projection.js";
import { printMultiProjectSummary } from "../src/cli/utils/render-multi-project-summary.js";

vi.mock("../src/cli/utils/compute-score-projection.js", () => ({
  computeProjectedScore: vi.fn(async () => null),
}));

const mockedComputeProjectedScore = vi.mocked(computeProjectedScore);

const buildProject = (projectName: string): ProjectInfo => ({
  rootDirectory: `/repo/${projectName}`,
  projectName,
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 3,
});

const buildDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-production-issue",
  severity: "error",
  message: "Issue",
  help: "Fix it",
  line: 1,
  column: 1,
  category: "Bugs",
  ...overrides,
});

const buildScan = (
  projectName: string,
  score: number,
  diagnostics: Diagnostic[],
  config: ReactDoctorConfig | null = null,
) => ({
  config,
  result: {
    diagnostics,
    score: { score, label: "Needs work" },
    skippedChecks: [],
    project: buildProject(projectName),
    elapsedMilliseconds: 10,
    scannedFileCount: 3,
    analyzedFiles: diagnostics.map((diagnostic) => diagnostic.filePath),
  } satisfies InspectResult,
});

const lowProductionDiagnostic = buildDiagnostic({
  filePath: "src/Low.tsx",
  rule: "no-low-production",
});
const lowTestDiagnostic = buildDiagnostic({
  filePath: "src/Low.test.tsx",
  rule: "no-low-test",
  fileContext: "test",
});
const lowStoryDiagnostic = buildDiagnostic({
  filePath: "src/Low.stories.tsx",
  rule: "no-low-story",
  fileContext: "story",
});
const lowDesignDiagnostic = buildDiagnostic({
  filePath: "src/LowDesign.tsx",
  rule: "design-no-redundant-size-axes",
  severity: "warning",
  category: "Maintainability",
});
const highProductionDiagnostic = buildDiagnostic({
  filePath: "src/High.tsx",
  rule: "no-high-production",
});
const highTestDiagnostic = buildDiagnostic({
  filePath: "src/High.test.tsx",
  rule: "no-high-test",
  fileContext: "test",
});

const renderSummary = async (
  lowConfig: ReactDoctorConfig | null = null,
  highConfig: ReactDoctorConfig | null = null,
): Promise<void> => {
  const completedScans = [
    buildScan(
      "low",
      40,
      [lowProductionDiagnostic, lowTestDiagnostic, lowStoryDiagnostic, lowDesignDiagnostic],
      lowConfig,
    ),
    buildScan("high", 80, [highProductionDiagnostic, highTestDiagnostic], highConfig),
  ];
  await Effect.runPromise(
    printMultiProjectSummary({
      completedScans,
      verbose: true,
      isOffline: true,
      projectName: "workspace",
      totalElapsedMilliseconds: 20,
    }),
  );
};

describe("printMultiProjectSummary score projection", () => {
  afterEach(() => {
    mockedComputeProjectedScore.mockClear();
    vi.restoreAllMocks();
  });

  it("projects the worst score from production diagnostics across projects", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await renderSummary();

    expect(mockedComputeProjectedScore).toHaveBeenCalledTimes(1);
    const [topErrorSource, rescoreSource] = mockedComputeProjectedScore.mock.calls[0];
    expect(topErrorSource).toEqual([lowProductionDiagnostic, highProductionDiagnostic]);
    expect(rescoreSource).toEqual([lowProductionDiagnostic]);
  });

  it("honors each project's explicit score-surface includes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await renderSummary(
      {
        surfaces: {
          score: {
            includeCategories: ["Bugs"],
            includeTags: ["design"],
          },
        },
      },
      {
        surfaces: {
          score: { includeRules: ["react-doctor/no-high-test"] },
        },
      },
    );

    expect(mockedComputeProjectedScore).toHaveBeenCalledTimes(1);
    const [topErrorSource, rescoreSource] = mockedComputeProjectedScore.mock.calls[0];
    expect(topErrorSource).toEqual([
      lowProductionDiagnostic,
      lowTestDiagnostic,
      lowStoryDiagnostic,
      lowDesignDiagnostic,
      highProductionDiagnostic,
      highTestDiagnostic,
    ]);
    expect(rescoreSource).toEqual([
      lowProductionDiagnostic,
      lowTestDiagnostic,
      lowStoryDiagnostic,
      lowDesignDiagnostic,
    ]);
  });

  it("does not project a score-eligible rule excluded from the CLI", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await renderSummary({
      surfaces: {
        cli: { excludeRules: ["react-doctor/no-low-production"] },
        score: { includeRules: ["react-doctor/no-low-production"] },
      },
    });

    expect(mockedComputeProjectedScore).toHaveBeenCalledTimes(1);
    const [topErrorSource, rescoreSource] = mockedComputeProjectedScore.mock.calls[0];
    expect(topErrorSource).toEqual([highProductionDiagnostic]);
    expect(rescoreSource).toEqual([lowProductionDiagnostic]);
  });
});
