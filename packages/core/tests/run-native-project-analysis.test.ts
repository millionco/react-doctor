import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defineProjectAnalysisConfig } from "../src/project-analysis/config.js";
import { runNativeProjectAnalysis } from "../src/project-analysis/run-native-project-analysis.js";
import type { DependencyGraph } from "../src/project-analysis/types.js";

const loadNativeOxlintBindingMock = vi.hoisted(() => vi.fn());

vi.mock("../src/runners/oxlint/load-native-oxlint-binding.js", () => ({
  loadNativeOxlintBinding: loadNativeOxlintBindingMock,
}));

beforeEach(() => {
  loadNativeOxlintBindingMock.mockReset();
});

const projectGraph = (): DependencyGraph => ({
  modules: [
    {
      fileId: { index: 0, path: "/project/src/index.ts" },
      imports: [],
      exports: [
        {
          name: "unusedValue",
          isDefault: false,
          isTypeOnly: false,
          isReExport: false,
          isSynthetic: false,
          reExportSource: undefined,
          reExportOriginalName: undefined,
          isNamespaceReExport: false,
          line: 2,
          column: 14,
        },
      ],
      memberAccesses: [{ objectName: "library", memberName: "used" }],
      wholeObjectUses: ["metadata"],
      localIdentifierReferences: ["localValue"],
      topLevelImportReferences: [],
      referencedFilenames: [],
      hasUnknownDynamicModuleLoad: false,
      parseErrors: [],
      isEntryPoint: false,
      isExternallyConsumed: false,
      isTestEntry: false,
      isReachable: true,
      isDeclarationFile: false,
      isConfigFile: false,
      isGitIgnored: false,
      isAnalysisExcluded: false,
      isAuthoritativeEntryPoint: false,
      isExplicitEntryPoint: false,
      isPackageGraphComplete: true,
      hasPackageDynamicLoaderUncertainty: false,
    },
  ],
  edges: [],
  reverseEdges: new Map(),
  fileIdMap: new Map([["/project/src/index.ts", 0]]),
});

describe("runNativeProjectAnalysis unused exports", () => {
  it("serializes the complete export-usage contract and parses ordered findings", () => {
    let serializedInput: unknown;
    loadNativeOxlintBindingMock.mockReturnValue({
      reactDoctorNativeProjectRuleIds: () => ["unused-export", "unused-type"],
      analyzeReactDoctorProjectGraph: (inputJson: string) => {
        serializedInput = JSON.parse(inputJson);
        return JSON.stringify({
          unusedExports: [
            {
              path: "/project/src/index.ts",
              name: "unusedValue",
              line: 2,
              column: 14,
              isTypeOnly: false,
            },
            {
              path: "/project/src/index.ts",
              name: "UnusedShape",
              line: 3,
              column: 18,
              isTypeOnly: true,
            },
          ],
        });
      },
    });

    const graph = projectGraph();
    const result = runNativeProjectAnalysis({
      graph,
      config: defineProjectAnalysisConfig({ rootDir: "/project" }),
      platformSiblingIndex: new Map([[0, [0, 1]]]),
    });

    expect(serializedInput).toMatchObject({
      modules: [
        expect.objectContaining({
          index: 0,
          path: "/project/src/index.ts",
          exports: [
            expect.objectContaining({
              name: "unusedValue",
              line: 2,
              column: 14,
              isTypeOnly: false,
              isReExport: false,
            }),
          ],
          memberAccesses: [{ objectName: "library", memberName: "used" }],
          wholeObjectUses: ["metadata"],
          localIdentifierReferences: ["localValue"],
          hasPackageDynamicLoaderUncertainty: false,
        }),
      ],
      platformSiblingIndices: [[0, 1]],
      conventionConsumedExports: [],
      reportTypes: true,
      includeEntryExports: false,
    });
    expect(result).toEqual({
      unusedExports: [
        {
          path: "/project/src/index.ts",
          name: "unusedValue",
          line: 2,
          column: 14,
          isTypeOnly: false,
        },
        {
          path: "/project/src/index.ts",
          name: "UnusedShape",
          line: 3,
          column: 18,
          isTypeOnly: true,
        },
      ],
    });
  });

  it("keeps valid unused-file output when export output is malformed", () => {
    loadNativeOxlintBindingMock.mockReturnValue({
      reactDoctorNativeProjectRuleIds: () => ["unused-export", "unused-file", "unused-type"],
      analyzeReactDoctorProjectGraph: () =>
        JSON.stringify({
          unusedFiles: [{ path: "/project/src/orphan.ts" }],
          verifiedUnusedFiles: [{ path: "/project/src/orphan.ts" }],
          unusedExports: null,
        }),
    });

    expect(
      runNativeProjectAnalysis({
        graph: projectGraph(),
        config: defineProjectAnalysisConfig({ rootDir: "/project" }),
        platformSiblingIndex: new Map(),
      }),
    ).toEqual({
      unusedFiles: [{ path: "/project/src/orphan.ts" }],
      verifiedUnusedFiles: [{ path: "/project/src/orphan.ts" }],
    });
  });
});
