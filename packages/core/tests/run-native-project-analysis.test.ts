import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { analyzeProject } from "../src/project-analysis/analyze-project.js";
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

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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

const circularProjectGraph = (): DependencyGraph => {
  const graph = projectGraph();
  const sourceModule = graph.modules[0];
  sourceModule.topLevelImportReferences.push("valueB");
  return {
    ...graph,
    modules: [
      sourceModule,
      {
        ...sourceModule,
        fileId: { index: 1, path: "/project/src/b.ts" },
        exports: [],
        memberAccesses: [],
        wholeObjectUses: [],
        localIdentifierReferences: [],
        topLevelImportReferences: [],
      },
    ],
    edges: [
      {
        source: 0,
        target: 1,
        importedSymbols: [
          {
            importedName: "valueB",
            localName: "valueB",
            isTypeOnly: false,
            isNamespace: false,
            isDefault: false,
          },
        ],
        isReExportEdge: false,
        isDynamic: false,
        isSideEffect: false,
        isTypeOnly: false,
        reExportedNames: [],
        reExportMappings: [],
      },
    ],
    reverseEdges: new Map([[1, [0]]]),
    fileIdMap: new Map([
      ["/project/src/index.ts", 0],
      ["/project/src/b.ts", 1],
    ]),
  };
};

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

describe("runNativeProjectAnalysis circular dependencies", () => {
  it("serializes cycle evidence and parses independently registered findings", () => {
    let serializedInput: unknown;
    loadNativeOxlintBindingMock.mockReturnValue({
      reactDoctorNativeProjectRuleIds: () => ["circular-dependency"],
      analyzeReactDoctorProjectGraph: (inputJson: string) => {
        serializedInput = JSON.parse(inputJson);
        return JSON.stringify({
          circularDependencies: [
            { files: ["/project/src/a.ts", "/project/src/b.ts", "/project/src/c.ts"] },
            { files: ["/project/src/a.ts", "/project/src/b.ts"] },
          ],
        });
      },
    });

    const result = runNativeProjectAnalysis({
      graph: circularProjectGraph(),
      config: defineProjectAnalysisConfig({ rootDir: "/project" }),
      platformSiblingIndex: new Map(),
    });

    expect(serializedInput).toMatchObject({
      modules: expect.arrayContaining([
        expect.objectContaining({
          path: "/project/src/index.ts",
          topLevelImportReferences: ["valueB"],
        }),
      ]),
      edges: expect.arrayContaining([
        expect.objectContaining({
          source: 0,
          target: 1,
          importedSymbols: expect.arrayContaining([
            expect.objectContaining({
              importedName: "valueB",
              localName: "valueB",
              isTypeOnly: false,
            }),
          ]),
          isDynamic: false,
          isSideEffect: false,
          isTypeOnly: false,
        }),
      ]),
    });
    expect(result).toEqual({
      circularDependencies: [
        { files: ["/project/src/a.ts", "/project/src/b.ts"] },
        { files: ["/project/src/a.ts", "/project/src/b.ts", "/project/src/c.ts"] },
      ],
    });
  });

  it("keeps valid unused-file output when cycle output is malformed", () => {
    loadNativeOxlintBindingMock.mockReturnValue({
      reactDoctorNativeProjectRuleIds: () => ["unused-file", "circular-dependency"],
      analyzeReactDoctorProjectGraph: () =>
        JSON.stringify({
          unusedFiles: [{ path: "/project/src/orphan.ts" }],
          verifiedUnusedFiles: [{ path: "/project/src/orphan.ts" }],
          circularDependencies: null,
        }),
    });

    expect(
      runNativeProjectAnalysis({
        graph: circularProjectGraph(),
        config: defineProjectAnalysisConfig({ rootDir: "/project" }),
        platformSiblingIndex: new Map(),
      }),
    ).toEqual({
      unusedFiles: [{ path: "/project/src/orphan.ts" }],
      verifiedUnusedFiles: [{ path: "/project/src/orphan.ts" }],
    });
  });

  it("falls back to the TypeScript cycle detector independently", async () => {
    const rootDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-native-project-analysis-"),
    );
    temporaryDirectories.push(rootDirectory);
    fs.writeFileSync(path.join(rootDirectory, "package.json"), "{}");
    fs.mkdirSync(path.join(rootDirectory, "src"));
    fs.writeFileSync(
      path.join(rootDirectory, "src/index.ts"),
      'import { valueA } from "./a"; console.log(valueA);',
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/a.ts"),
      'import { valueB } from "./b"; export const valueA = valueB + 1;',
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/b.ts"),
      'import { valueA } from "./a"; export const valueB = valueA + 1;',
    );
    loadNativeOxlintBindingMock.mockReturnValue({
      reactDoctorNativeProjectRuleIds: () => ["circular-dependency"],
      analyzeReactDoctorProjectGraph: () => JSON.stringify({ circularDependencies: null }),
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toHaveLength(1);
  });
});
