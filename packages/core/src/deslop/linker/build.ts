import path from "node:path";
import { minimatch } from "minimatch";
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

export interface ModuleLinkInput {
  fileId: SourceFile;
  parsed: ParsedSource;
  resolvedImports: Map<string, ResolvedImport>;
  isEntryPoint: boolean;
  isTestEntry: boolean;
  isGitIgnored: boolean;
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
    referencedFilenames: input.parsed.referencedFilenames,
    redundantTypePatterns: input.parsed.redundantTypePatterns,
    identityWrappers: input.parsed.identityWrappers,
    typeDefinitionHashes: input.parsed.typeDefinitionHashes,
    inlineTypeLiterals: input.parsed.inlineTypeLiterals,
    simplifiableFunctions: input.parsed.simplifiableFunctions,
    simplifiableExpressions: input.parsed.simplifiableExpressions,
    duplicateConstantCandidates: input.parsed.duplicateConstantCandidates,
    parseErrors: input.parsed.errors,
    isEntryPoint: input.isEntryPoint,
    isTestEntry: input.isTestEntry,
    isReachable: false,
    isDeclarationFile:
      input.fileId.path.endsWith(".d.ts") ||
      input.fileId.path.endsWith(".d.mts") ||
      input.fileId.path.endsWith(".d.cts"),
    isConfigFile: isConfigFile(input.fileId.path),
    isGitIgnored: input.isGitIgnored,
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
  ): void => {
    edges.push({
      source: sourceIndex,
      target: targetIndex,
      importedSymbols: symbols,
      isReExportEdge,
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
        for (const [filePath] of fileIdMap) {
          const relativePath = toPosixPath(path.relative(sourceDir, filePath));
          const normalizedRelative = relativePath.startsWith(".")
            ? relativePath
            : `./${relativePath}`;
          if (minimatch(normalizedRelative, globPattern)) {
            const targetIndex = fileIdMap.get(filePath);
            if (targetIndex !== undefined) {
              addEdge(sourceIndex, targetIndex, []);
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

      addEdge(sourceIndex, targetIndex, importedSymbols);
    }

    const reExportsByTarget = new Map<number, { names: string[]; mappings: ReExportMapping[] }>();
    for (const exportInfo of input.parsed.exports) {
      if (!exportInfo.isReExport || !exportInfo.reExportSource) continue;

      const resolved = input.resolvedImports.get(exportInfo.reExportSource);
      if (!resolved?.resolvedPath) continue;

      const targetIndex = fileIdMap.get(toPosixPath(resolved.resolvedPath));
      if (targetIndex === undefined) continue;

      const exportedName = exportInfo.isNamespaceReExport ? "*" : exportInfo.name;
      const originalName = exportInfo.isNamespaceReExport
        ? "*"
        : (exportInfo.reExportOriginalName ?? exportInfo.name);

      const existing = reExportsByTarget.get(targetIndex);
      if (existing) {
        existing.names.push(exportedName);
        existing.mappings.push({ exportedName, originalName });
      } else {
        reExportsByTarget.set(targetIndex, {
          names: [exportedName],
          mappings: [{ exportedName, originalName }],
        });
      }
    }

    for (const [
      targetIndex,
      { names: reExportedNames, mappings: reExportMappings },
    ] of reExportsByTarget) {
      addEdge(sourceIndex, targetIndex, [], true, reExportedNames, reExportMappings);
    }
  }

  return { modules, edges, reverseEdges, fileIdMap };
};
