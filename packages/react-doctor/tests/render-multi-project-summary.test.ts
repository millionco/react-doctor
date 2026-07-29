import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
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

describe("printMultiProjectSummary code frames", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  const writeSourceTree = (marker: string): string => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-frame-root-"));
    temporaryDirectories.push(directory);
    fs.mkdirSync(path.join(directory, "src"), { recursive: true });
    fs.writeFileSync(path.join(directory, "src/App.tsx"), `export const ${marker} = 1;\n`);
    return directory;
  };

  const renderFramedOutput = async (scanOverrides: {
    rootDirectory: string;
    frameSourceRoot?: string;
    filePath?: string;
  }): Promise<string> => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      lines.push(String(line ?? ""));
    });
    const framedScan = {
      config: null,
      frameSourceRoot: scanOverrides.frameSourceRoot,
      result: {
        diagnostics: [
          buildDiagnostic({
            filePath: scanOverrides.filePath ?? "src/App.tsx",
            line: 1,
            column: 14,
          }),
        ],
        score: { score: 40, label: "Needs work" },
        skippedChecks: [],
        project: { ...buildProject("app"), rootDirectory: scanOverrides.rootDirectory },
        elapsedMilliseconds: 10,
        scannedFileCount: 1,
        analyzedFiles: ["src/App.tsx"],
      } satisfies InspectResult,
    };
    await Effect.runPromise(
      printMultiProjectSummary({
        completedScans: [framedScan, buildScan("other", 80, [highProductionDiagnostic])],
        verbose: true,
        isOffline: true,
        projectName: "workspace",
        totalElapsedMilliseconds: 20,
      }),
    );
    return lines.join("\n");
  };

  // `--staged` scans a snapshot of the index but reports real package paths, so
  // the frame has to come from the snapshot. Reading the worktree would print
  // whatever is uncommitted under index-derived line numbers.
  it("reads the frame from frameSourceRoot rather than the reported project root", async () => {
    const worktreeDirectory = writeSourceTree("FROM_WORKTREE");
    const snapshotDirectory = writeSourceTree("FROM_SNAPSHOT");

    const output = await renderFramedOutput({
      rootDirectory: worktreeDirectory,
      frameSourceRoot: snapshotDirectory,
      filePath: path.join(worktreeDirectory, "src/App.tsx"),
    });

    expect(output).toContain("FROM_SNAPSHOT");
    expect(output).not.toContain("FROM_WORKTREE");
  });

  it("falls back to the project root when no frameSourceRoot is set", async () => {
    const worktreeDirectory = writeSourceTree("FROM_WORKTREE");

    const output = await renderFramedOutput({ rootDirectory: worktreeDirectory });

    expect(output).toContain("FROM_WORKTREE");
  });
});
