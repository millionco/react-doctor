import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NATIVE_REACT_DOCTOR_PROJECT_GRAPH_RULE_IDS,
  REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV,
} from "../../packages/core/src/constants.js";
import { defineProjectAnalysisConfig } from "../../packages/core/src/project-analysis/config.js";
import { detectCycles } from "../../packages/core/src/project-analysis/report/cycles.js";
import { detectDeadExports } from "../../packages/core/src/project-analysis/report/exports.js";
import { detectOrphanFiles } from "../../packages/core/src/project-analysis/report/files.js";
import {
  analyzeStalePackageInput,
  collectStalePackageAnalysisInput,
} from "../../packages/core/src/project-analysis/report/packages.js";
import {
  type NativeProjectAnalysisResult,
  runNativeProjectAnalysis,
} from "../../packages/core/src/project-analysis/run-native-project-analysis.js";
import type {
  DependencyGraph,
  ExportReference,
  LinkedSymbol,
  SourceModule,
} from "../../packages/core/src/project-analysis/types.js";
import {
  type DetectDuplicateJsxSubtreesOptions,
  type DuplicateJsxSubtreeFamily,
  type JsxDuplicationSource,
  detectDuplicateJsxSubtrees,
} from "../../packages/core/src/react-cleanup/detect-duplicate-jsx-subtrees.js";

interface NativeProjectBinding {
  readonly reactDoctorNativeProjectRuleIds: () => unknown;
  readonly analyzeReactDoctorProjectGraph: (inputJson: string) => unknown;
  readonly analyzeReactDoctorDuplicateJsx: (inputJson: string) => unknown;
}

interface NativeModuleContainer {
  exports: unknown;
}

interface SourceModuleInput {
  readonly index: number;
  readonly path: string;
  readonly exports?: ExportReference[];
  readonly topLevelImportReferences?: string[];
  readonly isReachable?: boolean;
}

interface DuplicateJsxParityCase {
  readonly name: string;
  readonly sources: JsxDuplicationSource[];
  readonly options?: DetectDuplicateJsxSubtreesOptions;
  readonly shouldFindDuplicate: boolean;
}

const NATIVE_PROJECT_GRAPH_RULE_IDS = [...NATIVE_REACT_DOCTOR_PROJECT_GRAPH_RULE_IDS].sort();

const NATIVE_PROJECT_RULE_IDS = [...NATIVE_PROJECT_GRAPH_RULE_IDS, "duplicate-jsx-subtree"].sort();

const FIRST_SORT_INDEX = 0;
const SINGLE_FAMILY_LIMIT = 1;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNativeProjectBinding = (value: unknown): value is NativeProjectBinding =>
  isRecord(value) &&
  typeof value.reactDoctorNativeProjectRuleIds === "function" &&
  typeof value.analyzeReactDoctorProjectGraph === "function" &&
  typeof value.analyzeReactDoctorDuplicateJsx === "function";

const readOption = (name: string): string | undefined => {
  const optionIndex = process.argv.indexOf(name);
  if (optionIndex < 0) return undefined;
  const value = process.argv[optionIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
};

const resolveBindingPath = (): string => {
  const configuredPath =
    readOption("--binding") ?? process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV];
  if (configuredPath !== undefined) return path.resolve(configuredPath);
  const outputDirectory = path.join(repositoryRoot, "dist", "native-oxlint");
  const candidates = fs.existsSync(outputDirectory)
    ? fs
        .readdirSync(outputDirectory)
        .filter((fileName) => fileName.endsWith(".node"))
        .sort()
        .map((fileName) => path.join(outputDirectory, fileName))
    : [];
  if (candidates.length !== 1) {
    throw new Error(
      "Pass --binding or set REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH when dist/native-oxlint does not contain exactly one binding.",
    );
  }
  return candidates[0];
};

const loadBinding = (bindingPath: string): NativeProjectBinding => {
  if (!fs.existsSync(bindingPath)) throw new Error(`Native binding not found: ${bindingPath}`);
  const nativeModule: NativeModuleContainer = { exports: {} };
  process.dlopen(nativeModule, bindingPath);
  const binding = nativeModule.exports;
  if (!isNativeProjectBinding(binding)) {
    const bindingKeys = isRecord(binding) ? Object.keys(binding).join(", ") : typeof binding;
    throw new Error(
      `Native binding does not export the project analysis APIs (${bindingKeys}): ${bindingPath}`,
    );
  }
  return binding;
};

const createExport = (name: string, line: number, isTypeOnly = false): ExportReference => ({
  name,
  isDefault: false,
  isTypeOnly,
  isReExport: false,
  isSynthetic: false,
  reExportSource: undefined,
  reExportOriginalName: undefined,
  isNamespaceReExport: false,
  line,
  column: 14,
});

const createSourceModule = (input: SourceModuleInput): SourceModule => ({
  fileId: { index: input.index, path: input.path },
  imports: [],
  exports: input.exports ?? [],
  memberAccesses: [],
  wholeObjectUses: [],
  localIdentifierReferences: [],
  topLevelImportReferences: input.topLevelImportReferences ?? [],
  referencedFilenames: [],
  hasUnknownDynamicModuleLoad: false,
  parseErrors: [],
  isEntryPoint: false,
  isExternallyConsumed: false,
  isTestEntry: false,
  isReachable: input.isReachable ?? true,
  isDeclarationFile: false,
  isConfigFile: false,
  isGitIgnored: false,
  isAnalysisExcluded: false,
  isAuthoritativeEntryPoint: false,
  isExplicitEntryPoint: false,
  isPackageGraphComplete: true,
  hasPackageDynamicLoaderUncertainty: false,
});

const createLinkedSymbol = (name: string): LinkedSymbol => ({
  importedName: name,
  localName: name,
  isTypeOnly: false,
  isNamespace: false,
  isDefault: false,
});

const createProjectGraph = (rootDirectory: string): DependencyGraph => {
  const cycleAPath = path.join(rootDirectory, "src/cycle-a.ts");
  const cycleBPath = path.join(rootDirectory, "src/cycle-b.ts");
  const orphanPath = path.join(rootDirectory, "src/orphan.ts");
  const modules = [
    createSourceModule({
      index: 0,
      path: cycleAPath,
      exports: [
        createExport("valueA", 1),
        createExport("unusedValue", 2),
        createExport("UnusedShape", 3, true),
      ],
      topLevelImportReferences: ["valueB"],
    }),
    createSourceModule({
      index: 1,
      path: cycleBPath,
      exports: [createExport("valueB", 1)],
      topLevelImportReferences: ["valueA"],
    }),
    createSourceModule({ index: 2, path: orphanPath, isReachable: false }),
  ];
  return {
    modules,
    edges: [
      {
        source: 0,
        target: 1,
        importedSymbols: [createLinkedSymbol("valueB")],
        isReExportEdge: false,
        isDynamic: false,
        isSideEffect: false,
        isTypeOnly: false,
        reExportedNames: [],
        reExportMappings: [],
      },
      {
        source: 1,
        target: 0,
        importedSymbols: [createLinkedSymbol("valueA")],
        isReExportEdge: false,
        isDynamic: false,
        isSideEffect: false,
        isTypeOnly: false,
        reExportedNames: [],
        reExportMappings: [],
      },
    ],
    reverseEdges: new Map([
      [0, [1]],
      [1, [0]],
    ]),
    fileIdMap: new Map(modules.map((module) => [module.fileId.path, module.fileId.index])),
  };
};

const componentSource = (componentName: string, title: string, variableName: string): string => `
export const ${componentName} = () => (
  <section className="card">
    <header><h2>${title}</h2></header>
    <main><Value value={${variableName}} /></main>
    <footer><Button /></footer>
  </section>
);
`;

const createDuplicateJsxParityCases = (): DuplicateJsxParityCase[] => {
  const accountCard = componentSource("AccountCard", "Account", "account");
  const userCard = componentSource("UserCard", "User", "user");
  return [
    {
      name: "cross-file duplicate",
      sources: [
        { path: "src/account-card.tsx", sourceText: accountCard },
        { path: "src/user-card.tsx", sourceText: userCard },
      ],
      shouldFindDuplicate: true,
    },
    {
      name: "same-file composition roots",
      sources: [{ path: "src/cards.tsx", sourceText: `${accountCard}\n${userCard}` }],
      shouldFindDuplicate: true,
    },
    {
      name: "repeated siblings in one composition root",
      sources: [
        {
          path: "src/page.tsx",
          sourceText: `
const Page = () => (
  <main>
    <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
    <section><header><Title /><Subtitle /></header><article><Body /><Actions /></article></section>
  </main>
);
`,
        },
      ],
      shouldFindDuplicate: false,
    },
    {
      name: "minimum distinct file threshold",
      sources: [{ path: "src/cards.tsx", sourceText: `${accountCard}\n${userCard}` }],
      options: { minimumDistinctFiles: 2 },
      shouldFindDuplicate: false,
    },
  ];
};

const verifyProjectAnalysisParity = (bindingPath: string, temporaryRoot: string): void => {
  const rootDirectory = path.join(temporaryRoot, "project-analysis");
  fs.mkdirSync(rootDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(rootDirectory, "package.json"),
    `${JSON.stringify({
      name: "native-project-parity",
      private: true,
      dependencies: { "unused-production-package": "1.0.0" },
      devDependencies: { "unused-development-package": "1.0.0" },
    })}\n`,
  );
  const graph = createProjectGraph(rootDirectory);
  const config = defineProjectAnalysisConfig({ rootDir: rootDirectory });
  const platformSiblingIndex = new Map<number, ReadonlyArray<number>>();
  const stalePackageAnalysis = collectStalePackageAnalysisInput(graph, config);
  if (stalePackageAnalysis === null) {
    throw new Error("Project fixture must produce package analysis input");
  }

  const stalePackageReport = analyzeStalePackageInput(stalePackageAnalysis);
  const expected: NativeProjectAnalysisResult = {
    unusedFiles: detectOrphanFiles(graph),
    verifiedUnusedFiles: detectOrphanFiles(graph, { requireCompletePackageGraph: true }),
    unusedExports: detectDeadExports(graph, config, platformSiblingIndex),
    unusedDependencies: stalePackageReport.unusedDependencies,
    skippedDependencies: stalePackageReport.skippedDependencies,
    circularDependencies: detectCycles(graph),
  };
  assert.ok(expected.unusedFiles?.length, "unused-file fixture did not fire");
  assert.ok(
    expected.unusedExports?.some((finding) => !finding.isTypeOnly),
    "unused-export fixture did not fire",
  );
  assert.ok(
    expected.unusedExports?.some((finding) => finding.isTypeOnly),
    "unused-type fixture did not fire",
  );
  assert.ok(
    expected.unusedDependencies?.some((finding) => !finding.isDevDependency),
    "unused-dependency fixture did not fire",
  );
  assert.ok(
    expected.unusedDependencies?.some((finding) => finding.isDevDependency),
    "unused-dev-dependency fixture did not fire",
  );
  assert.ok(expected.circularDependencies?.length, "circular-dependency fixture did not fire");

  process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV] = bindingPath;
  const actual = runNativeProjectAnalysis({ graph, config, platformSiblingIndex });
  assert.notEqual(actual, null, "Native project analysis was not available");
  assert.deepEqual(
    actual,
    expected,
    "analyzeReactDoctorProjectGraph output differs from TypeScript",
  );
};

const verifyNativeDuplicateFamily = (
  binding: NativeProjectBinding,
  family: DuplicateJsxSubtreeFamily,
  caseName: string,
): void => {
  const occurrences = [family.primaryOccurrence, ...family.relatedOccurrences];
  const sortedPaths = [...new Set(occurrences.map((occurrence) => occurrence.path))].sort(
    (left, right) => left.localeCompare(right),
  );
  const pathSortIndexByPath = new Map(
    sortedPaths.map((sourcePath, pathSortIndex) => [sourcePath, pathSortIndex]),
  );
  const outputJson = binding.analyzeReactDoctorDuplicateJsx(
    JSON.stringify({
      candidates: occurrences.map((occurrence) => ({
        fingerprint: family.fingerprint,
        fingerprintSortIndex: FIRST_SORT_INDEX,
        nodeCount: family.nodeCount,
        depth: family.depth,
        occurrence: {
          ...occurrence,
          pathSortIndex: pathSortIndexByPath.get(occurrence.path) ?? FIRST_SORT_INDEX,
        },
      })),
      minimumNodeCount: family.nodeCount,
      minimumDepth: family.depth,
      minimumOccurrences: family.occurrenceCount,
      minimumDistinctFiles: family.distinctFileCount,
      maxFamilies: SINGLE_FAMILY_LIMIT,
    }),
  );
  if (typeof outputJson !== "string") {
    throw new Error(`${caseName}: native duplicate JSX output must be JSON`);
  }
  assert.deepEqual(
    JSON.parse(outputJson),
    [family],
    `${caseName}: direct analyzeReactDoctorDuplicateJsx output differs from TypeScript`,
  );
};

const verifyDuplicateJsxParity = (
  binding: NativeProjectBinding,
  bindingPath: string,
  temporaryRoot: string,
): number => {
  const cases = createDuplicateJsxParityCases();
  const missingBindingPath = path.join(temporaryRoot, "missing-native-binding.node");
  for (const parityCase of cases) {
    process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV] = missingBindingPath;
    const typescriptResult = detectDuplicateJsxSubtrees(parityCase.sources, parityCase.options);
    assert.equal(
      typescriptResult.families.length > 0,
      parityCase.shouldFindDuplicate,
      `${parityCase.name}: TypeScript fixture expectation changed`,
    );
    for (const family of typescriptResult.families) {
      verifyNativeDuplicateFamily(binding, family, parityCase.name);
    }
    process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV] = bindingPath;
    const nativeResult = detectDuplicateJsxSubtrees(parityCase.sources, parityCase.options);
    assert.deepEqual(
      nativeResult,
      typescriptResult,
      `${parityCase.name}: analyzeReactDoctorDuplicateJsx output differs from TypeScript`,
    );
  }
  return cases.length;
};

const run = (): void => {
  const bindingPath = resolveBindingPath();
  const binding = loadBinding(bindingPath);
  const advertisedRuleIds = binding.reactDoctorNativeProjectRuleIds();
  assert.ok(Array.isArray(advertisedRuleIds), "Native project rule IDs must be an array");
  assert.ok(
    advertisedRuleIds.every((ruleId) => typeof ruleId === "string"),
    "Native project rule IDs must contain only strings",
  );
  assert.equal(
    new Set(advertisedRuleIds).size,
    advertisedRuleIds.length,
    "Duplicate native project rule ID",
  );
  assert.deepEqual([...advertisedRuleIds].sort(), NATIVE_PROJECT_RULE_IDS);

  const previousBindingPath = process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV];
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-project-parity-"));
  try {
    verifyProjectAnalysisParity(bindingPath, temporaryRoot);
    const duplicateJsxCaseCount = verifyDuplicateJsxParity(binding, bindingPath, temporaryRoot);
    process.stdout.write(
      `Native project parity passed: ${NATIVE_PROJECT_GRAPH_RULE_IDS.length} graph rules and duplicate JSX across ${duplicateJsxCaseCount} cases.\n`,
    );
  } finally {
    if (previousBindingPath === undefined) {
      delete process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV];
    } else {
      process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV] = previousBindingPath;
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

run();
