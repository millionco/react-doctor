import path from "node:path";
import type {
  SourceFile,
  DependencyGraph,
  SourceModule,
  Edge,
  LinkedSymbol,
  ReExportMapping,
} from "../types.js";
import type { ParsedSource } from "../collect/parse.js";
import type { ResolvedImport } from "../resolver/resolve.js";
import { isConfigFile } from "../utils/is-config-file.js";
import { toPosixPath } from "../utils/to-posix-path.js";
import { compileGlobPattern } from "../../utils/match-glob-pattern.js";
import { createImportGlobFilter } from "../utils/create-import-glob-filter.js";

export interface ModuleLinkInput {
  fileId: SourceFile;
  parsed: ParsedSource;
  resolvedImports: Map<string, ResolvedImport>;
  isEntryPoint: boolean;
  isExternallyConsumed: boolean;
  isTestEntry: boolean;
  isGitIgnored: boolean;
  isAnalysisExcluded: boolean;
  isAuthoritativeEntryPoint: boolean;
  isExplicitEntryPoint: boolean;
}

export const buildDependencyGraph = (inputs: ModuleLinkInput[]): DependencyGraph => {
  const normalizedInputs = inputs.map((input) => ({
    ...input,
    fileId: {
      ...input.fileId,
      path: toPosixPath(input.fileId.path),
    },
  }));

  const fileIdMap = new Map<string, number>();
  for (const input of normalizedInputs) {
    fileIdMap.set(input.fileId.path, input.fileId.index);
  }

  const modules: SourceModule[] = normalizedInputs.map((input) => ({
    fileId: input.fileId,
    imports: input.parsed.imports,
    exports: input.parsed.exports,
    memberAccesses: input.parsed.memberAccesses,
    wholeObjectUses: input.parsed.wholeObjectUses,
    localIdentifierReferences: input.parsed.localIdentifierReferences,
    topLevelImportReferences: input.parsed.topLevelImportReferences,
    referencedFilenames: input.parsed.referencedFilenames,
    hasUnknownDynamicModuleLoad: input.parsed.hasUnknownDynamicModuleLoad,
    parseErrors: input.parsed.errors,
    isEntryPoint: input.isEntryPoint,
    isExternallyConsumed: input.isExternallyConsumed,
    isTestEntry: input.isTestEntry,
    isReachable: false,
    isDeclarationFile:
      input.fileId.path.endsWith(".d.ts") ||
      input.fileId.path.endsWith(".d.mts") ||
      input.fileId.path.endsWith(".d.cts"),
    isConfigFile: isConfigFile(input.fileId.path),
    isGitIgnored: input.isGitIgnored,
    isAnalysisExcluded: input.isAnalysisExcluded || input.parsed.isGenerated,
    isAuthoritativeEntryPoint: input.isAuthoritativeEntryPoint,
    isExplicitEntryPoint: input.isExplicitEntryPoint,
    isPackageGraphComplete: false,
    hasPackageDynamicLoaderUncertainty: false,
  }));

  const edges: Edge[] = [];
  const reverseEdges = new Map<number, number[]>();

  const addEdge = (
    sourceIndex: number,
    targetIndex: number,
    symbols: LinkedSymbol[],
    isReExportEdge: boolean = false,
    reExportedNames: string[] = [],
    reExportMappings: ReExportMapping[] = [],
    isDynamic: boolean = false,
    isSideEffect: boolean = false,
    isTypeOnly: boolean = false,
  ): void => {
    edges.push({
      source: sourceIndex,
      target: targetIndex,
      importedSymbols: symbols,
      isReExportEdge,
      isDynamic,
      isSideEffect,
      isTypeOnly,
      reExportedNames,
      reExportMappings,
    });

    const existingReverseEdges = reverseEdges.get(targetIndex);
    if (existingReverseEdges) {
      if (!existingReverseEdges.includes(sourceIndex)) {
        existingReverseEdges.push(sourceIndex);
      }
    } else {
      reverseEdges.set(targetIndex, [sourceIndex]);
    }
  };

  for (const input of normalizedInputs) {
    const sourceIndex = input.fileId.index;

    for (const importInfo of input.parsed.imports) {
      if (importInfo.isGlob) {
        const sourceDir = path.dirname(input.fileId.path);
        const globPattern = importInfo.specifier;
        const globExpression = compileGlobPattern(globPattern);
        const importGlobFilter = createImportGlobFilter(importInfo, input.fileId.path);
        for (const [filePath] of fileIdMap) {
          const relativePath = toPosixPath(path.relative(sourceDir, filePath));
          if (globExpression.test(relativePath) && importGlobFilter(filePath)) {
            const targetIndex = fileIdMap.get(filePath);
            if (targetIndex !== undefined) {
              addEdge(sourceIndex, targetIndex, [], false, [], [], true);
            }
          }
        }
        continue;
      }

      const resolved = input.resolvedImports.get(importInfo.specifier);
      if (!resolved?.resolvedPath) continue;

      const targetIndex = fileIdMap.get(toPosixPath(resolved.resolvedPath));
      if (targetIndex === undefined) continue;

      const importedSymbols: LinkedSymbol[] = importInfo.importedNames.map((importedName) => ({
        importedName: importedName.name,
        localName: importedName.alias ?? importedName.name,
        isTypeOnly: importedName.isTypeOnly,
        isNamespace: importedName.isNamespace,
        isDefault: importedName.isDefault,
      }));

      addEdge(
        sourceIndex,
        targetIndex,
        importedSymbols,
        false,
        [],
        [],
        importInfo.isDynamic,
        importInfo.isSideEffect,
      );
    }

    const reExportsByTarget = new Map<
      number,
      { names: string[]; mappings: ReExportMapping[]; isTypeOnly: boolean }
    >();
    for (const exportInfo of input.parsed.exports) {
      if (!exportInfo.isReExport || !exportInfo.reExportSource) continue;

      const resolved = input.resolvedImports.get(exportInfo.reExportSource);
      if (!resolved?.resolvedPath) continue;

      const targetIndex = fileIdMap.get(toPosixPath(resolved.resolvedPath));
      if (targetIndex === undefined) continue;

      const exportedName = exportInfo.name;
      const originalName = exportInfo.isNamespaceReExport
        ? "*"
        : (exportInfo.reExportOriginalName ?? exportInfo.name);

      const existing = reExportsByTarget.get(targetIndex);
      if (existing) {
        existing.names.push(exportedName);
        existing.mappings.push({ exportedName, originalName });
        existing.isTypeOnly = existing.isTypeOnly && exportInfo.isTypeOnly;
      } else {
        reExportsByTarget.set(targetIndex, {
          names: [exportedName],
          mappings: [{ exportedName, originalName }],
          isTypeOnly: exportInfo.isTypeOnly,
        });
      }
    }

    for (const [
      targetIndex,
      { names: reExportedNames, mappings: reExportMappings, isTypeOnly },
    ] of reExportsByTarget) {
      addEdge(
        sourceIndex,
        targetIndex,
        [],
        true,
        reExportedNames,
        reExportMappings,
        false,
        false,
        isTypeOnly,
      );
    }
  }

  return { modules, edges, reverseEdges, fileIdMap };
};
