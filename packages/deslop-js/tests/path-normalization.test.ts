import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toPosixPath } from "../src/utils/to-posix-path.js";
import { buildDependencyGraph, type ModuleLinkInput } from "../src/linker/build.js";
import { traceReachability } from "../src/linker/reachability.js";
import { detectDeadExports } from "../src/report/exports.js";
import type { ParsedSource } from "../src/collect/parse.js";
import type { ResolvedImport } from "../src/resolver/resolve.js";
import type { DeslopConfig, ExportReference, ImportReference } from "../src/types.js";

const emptyParsed = (overrides: Partial<ParsedSource> = {}): ParsedSource => ({
  imports: [],
  exports: [],
  memberAccesses: [],
  wholeObjectUses: [],
  localIdentifierReferences: [],
  referencedFilenames: [],
  redundantTypePatterns: [],
  identityWrappers: [],
  typeDefinitionHashes: [],
  inlineTypeLiterals: [],
  simplifiableFunctions: [],
  simplifiableExpressions: [],
  duplicateConstantCandidates: [],
  errors: [],
  ...overrides,
});

const namedImport = (specifier: string, importedName: string): ImportReference => ({
  specifier,
  importedNames: [
    {
      name: importedName,
      alias: undefined,
      isNamespace: false,
      isDefault: false,
      isTypeOnly: false,
    },
  ],
  isTypeOnly: false,
  isDynamic: false,
  isSideEffect: false,
  isGlob: false,
  line: 1,
  column: 1,
});

const namedExport = (name: string, overrides: Partial<ExportReference> = {}): ExportReference => ({
  name,
  isDefault: false,
  isTypeOnly: false,
  isReExport: false,
  isSynthetic: false,
  reExportSource: undefined,
  reExportOriginalName: undefined,
  isNamespaceReExport: false,
  line: 1,
  column: 1,
  ...overrides,
});

const deadExportConfig: DeslopConfig = {
  rootDir: "C:/project",
  entryPatterns: [],
  ignorePatterns: [],
  includeExtensions: [],
  tsConfigPath: undefined,
  reportTypes: false,
  includeEntryExports: false,
  reportRedundancy: true,
  semantic: undefined,
  duplicateBlocks: undefined,
  featureFlags: undefined,
  complexity: undefined,
};

describe("toPosixPath", () => {
  it("converts windows separators to forward slashes", () => {
    assert.equal(toPosixPath("C:\\project\\src\\App.tsx"), "C:/project/src/App.tsx");
  });

  it("leaves posix paths untouched", () => {
    assert.equal(toPosixPath("/project/src/App.tsx"), "/project/src/App.tsx");
  });

  it("normalizes mixed separators", () => {
    assert.equal(toPosixPath("C:/project\\src/App.tsx"), "C:/project/src/App.tsx");
  });
});

describe("buildDependencyGraph cross-platform path keying", () => {
  it("links imports when the resolver returns backslash paths", () => {
    const entry: ModuleLinkInput = {
      fileId: { index: 0, path: "C:/project/src/index.ts" },
      parsed: emptyParsed({ imports: [namedImport("./app", "App")] }),
      resolvedImports: new Map<string, ResolvedImport>([
        [
          "./app",
          { resolvedPath: "C:\\project\\src\\app.ts", isExternal: false, packageName: undefined },
        ],
      ]),
      isEntryPoint: true,
      isTestEntry: false,
      isGitIgnored: false,
    };
    const target: ModuleLinkInput = {
      fileId: { index: 1, path: "C:/project/src/app.ts" },
      parsed: emptyParsed(),
      resolvedImports: new Map<string, ResolvedImport>(),
      isEntryPoint: false,
      isTestEntry: false,
      isGitIgnored: false,
    };

    const graph = buildDependencyGraph([entry, target]);

    assert.ok(
      graph.edges.some((edge) => edge.source === 0 && edge.target === 1),
      "expected an import edge despite the backslash resolved path",
    );

    traceReachability(graph);
    assert.equal(
      graph.modules[1].isReachable,
      true,
      "app.ts must be reachable from the entry point and not reported as an unused file",
    );
  });

  it("keeps module paths normalized for re-export chain lookup", () => {
    const entry: ModuleLinkInput = {
      fileId: { index: 0, path: "C:\\project\\src\\index.ts" },
      parsed: emptyParsed({
        exports: [
          namedExport("foo", {
            isReExport: true,
            reExportSource: "./barrel",
            reExportOriginalName: "foo",
          }),
        ],
      }),
      resolvedImports: new Map<string, ResolvedImport>([
        [
          "./barrel",
          {
            resolvedPath: "C:\\project\\src\\barrel.ts",
            isExternal: false,
            packageName: undefined,
          },
        ],
      ]),
      isEntryPoint: true,
      isTestEntry: false,
      isGitIgnored: false,
    };
    const barrel: ModuleLinkInput = {
      fileId: { index: 1, path: "C:\\project\\src\\barrel.ts" },
      parsed: emptyParsed({
        exports: [
          namedExport("foo", {
            isReExport: true,
            reExportSource: "./foo",
            reExportOriginalName: "foo",
          }),
        ],
      }),
      resolvedImports: new Map<string, ResolvedImport>([
        [
          "./foo",
          { resolvedPath: "C:\\project\\src\\foo.ts", isExternal: false, packageName: undefined },
        ],
      ]),
      isEntryPoint: false,
      isTestEntry: false,
      isGitIgnored: false,
    };
    const target: ModuleLinkInput = {
      fileId: { index: 2, path: "C:\\project\\src\\foo.ts" },
      parsed: emptyParsed({ exports: [namedExport("foo")] }),
      resolvedImports: new Map<string, ResolvedImport>(),
      isEntryPoint: false,
      isTestEntry: false,
      isGitIgnored: false,
    };

    const graph = buildDependencyGraph([entry, barrel, target]);

    assert.equal(graph.modules[0].fileId.path, "C:/project/src/index.ts");
    assert.equal(graph.modules[1].fileId.path, "C:/project/src/barrel.ts");
    assert.equal(graph.modules[2].fileId.path, "C:/project/src/foo.ts");

    traceReachability(graph);
    const unusedExports = detectDeadExports(graph, deadExportConfig);

    assert.deepEqual(
      unusedExports.map((unusedExport) => unusedExport.path),
      [],
      "re-export chains must resolve through normalized graph file paths",
    );
  });
});
