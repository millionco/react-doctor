import type {
  DependencyGraph,
  Edge,
  SourceModule,
  ExportReference,
  UnusedExport,
  ProjectAnalysisConfig,
  MemberAccess,
} from "../types.js";
import { collectConventionConsumedExportKeys } from "../utils/collect-convention-consumed-export-keys.js";
import { buildExportKey } from "../utils/build-export-key.js";

interface ReExportTarget {
  readonly targetIndex: number;
  readonly mappings: Edge["reExportMappings"];
}

export const detectDeadExports = (
  graph: DependencyGraph,
  config: ProjectAnalysisConfig,
  platformSiblingIndex: ReadonlyMap<number, ReadonlyArray<number>> = new Map(),
): UnusedExport[] => {
  const usageMap = buildUsageMap(graph, platformSiblingIndex);
  const conventionConsumedExportKeys = collectConventionConsumedExportKeys(graph);
  const unusedExports: UnusedExport[] = [];

  for (const module of graph.modules) {
    if (module.hasPackageDynamicLoaderUncertainty) continue;
    if (!module.isReachable && !module.isExternallyConsumed) continue;
    if (module.isDeclarationFile) continue;
    if (module.isGitIgnored) continue;
    if (module.isAnalysisExcluded) continue;
    if (module.isEntryPoint && !config.includeEntryExports) continue;

    const defaultExportLinkedNames = new Set<string>();
    for (const exportInfo of module.exports) {
      if (
        exportInfo.isDefault &&
        exportInfo.defaultExportLocalName &&
        usageMap.has(`${module.fileId.path}::default`)
      ) {
        defaultExportLinkedNames.add(exportInfo.defaultExportLocalName);
      }
    }

    for (const exportInfo of module.exports) {
      if (exportInfo.name === "*" && exportInfo.isNamespaceReExport) continue;
      if (exportInfo.isReExport && exportInfo.reExportOriginalName) continue;
      if (!config.reportTypes && exportInfo.isTypeOnly) continue;

      const usageKey = `${module.fileId.path}::${exportInfo.name}`;
      if (usageMap.has(usageKey)) continue;
      if (conventionConsumedExportKeys.has(buildExportKey(module.fileId.path, exportInfo.name))) {
        continue;
      }

      if (module.localIdentifierReferences.includes(exportInfo.name)) continue;

      if (!exportInfo.isDefault && defaultExportLinkedNames.has(exportInfo.name)) {
        continue;
      }

      // `export default Page` aliasing a named export that IS consumed:
      // deleting the default would be busywork the named usage disproves.
      if (
        exportInfo.isDefault &&
        exportInfo.defaultExportLocalName &&
        usageMap.has(`${module.fileId.path}::${exportInfo.defaultExportLocalName}`)
      ) {
        continue;
      }

      unusedExports.push({
        path: module.fileId.path,
        name: exportInfo.name,
        line: exportInfo.line,
        column: exportInfo.column,
        isTypeOnly: exportInfo.isTypeOnly,
      });
    }
  }

  return unusedExports;
};

const buildUsageMap = (
  graph: DependencyGraph,
  platformSiblingIndex: ReadonlyMap<number, ReadonlyArray<number>>,
): Set<string> => {
  const usedExportKeys = new Set<string>();
  const sourceToTargetMap = buildSourceToTargetsMap(graph, platformSiblingIndex);

  // Indexed by source so the entry-point pass is O(edges), not
  // O(entry points × edges) — on a large repo with thousands of entry
  // modules the unindexed scan dominated this detector.
  const reExportEdgesBySource = new Map<number, Edge[]>();
  for (const edge of graph.edges) {
    if (!edge.isReExportEdge) continue;
    const existingEdges = reExportEdgesBySource.get(edge.source);
    if (existingEdges) {
      existingEdges.push(edge);
    } else {
      reExportEdgesBySource.set(edge.source, [edge]);
    }
  }

  for (const module of graph.modules) {
    if (!module.isEntryPoint) continue;

    for (const edge of reExportEdgesBySource.get(module.fileId.index) ?? []) {
      const isWildcardReExport = edge.reExportedNames.includes("*");
      for (const targetIndex of platformSiblingIndex.get(edge.target) ?? [edge.target]) {
        const targetModule = graph.modules[targetIndex];
        if (!targetModule) continue;

        if (isWildcardReExport) {
          markAllExportsUsedRecursive(
            targetModule,
            graph,
            sourceToTargetMap,
            usedExportKeys,
            new Set(),
          );
        } else {
          for (const mapping of edge.reExportMappings) {
            if (mapping.originalName === "*") {
              markAllExportsUsedRecursive(
                targetModule,
                graph,
                sourceToTargetMap,
                usedExportKeys,
                new Set(),
              );
            } else {
              markExportUsedRecursive(
                targetModule.fileId.path,
                mapping.originalName,
                graph,
                sourceToTargetMap,
                usedExportKeys,
                new Set(),
              );
            }
          }
        }
      }
    }
  }

  for (const edge of graph.edges) {
    const sourceModule = graph.modules[edge.source];
    for (const targetIndex of platformSiblingIndex.get(edge.target) ?? [edge.target]) {
      const targetModule = graph.modules[targetIndex];
      if (!targetModule) continue;

      // `import()` consumers are opaque: `lazy(() => import("./page"))` takes
      // the default, `.then((m) => m.X)` takes named members, and neither shows
      // up as an imported symbol. Treat every export of a dynamically imported
      // module as used rather than flag exports we cannot trace.
      if (edge.isDynamic && edge.importedSymbols.length === 0) {
        markAllExportsUsedRecursive(
          targetModule,
          graph,
          sourceToTargetMap,
          usedExportKeys,
          new Set(),
        );
        continue;
      }

      for (const symbol of edge.importedSymbols) {
        if (symbol.isNamespace) {
          handleNamespaceImport(
            sourceModule,
            targetModule,
            symbol.localName,
            graph,
            sourceToTargetMap,
            usedExportKeys,
          );
        } else {
          const importName = symbol.isDefault ? "default" : symbol.importedName;
          markExportUsedRecursive(
            targetModule.fileId.path,
            importName,
            graph,
            sourceToTargetMap,
            usedExportKeys,
            new Set(),
          );

          if (symbol.isDefault) {
            const hasDefaultExport = targetModule.exports.some(
              (exportInfo) => exportInfo.isDefault,
            );
            if (!hasDefaultExport && symbol.localName !== "default") {
              const matchingNamedExport = targetModule.exports.find(
                (exportInfo) => exportInfo.name === symbol.localName,
              );
              if (matchingNamedExport) {
                markExportUsedRecursive(
                  targetModule.fileId.path,
                  symbol.localName,
                  graph,
                  sourceToTargetMap,
                  usedExportKeys,
                  new Set(),
                );
              }
            }
          }
        }
      }
    }
  }

  return usedExportKeys;
};

const handleNamespaceImport = (
  sourceModule: SourceModule | undefined,
  targetModule: SourceModule,
  namespaceLocalName: string,
  graph: DependencyGraph,
  sourceToTargets: Map<number, ReExportTarget[]>,
  usedKeys: Set<string>,
): void => {
  if (!sourceModule) {
    markAllExportsUsedRecursive(targetModule, graph, sourceToTargets, usedKeys, new Set());
    return;
  }

  const isWholeObjectUse = sourceModule.wholeObjectUses.includes(namespaceLocalName);
  if (isWholeObjectUse) {
    markAllExportsUsedRecursive(targetModule, graph, sourceToTargets, usedKeys, new Set());
    return;
  }

  const accessedMemberNames = extractAccessedMemberNames(
    sourceModule.memberAccesses,
    namespaceLocalName,
  );

  const isNamespaceReExported = sourceModule.exports.some(
    (exportInfo) =>
      exportInfo.reExportOriginalName === namespaceLocalName ||
      (!exportInfo.isReExport && exportInfo.name === namespaceLocalName),
  );

  if (accessedMemberNames.length === 0 && !isNamespaceReExported) {
    markAllExportsUsedRecursive(targetModule, graph, sourceToTargets, usedKeys, new Set());
    return;
  }

  if (isNamespaceReExported) {
    markAllExportsUsedRecursive(targetModule, graph, sourceToTargets, usedKeys, new Set());
    return;
  }

  for (const memberName of accessedMemberNames) {
    markExportUsedRecursive(
      targetModule.fileId.path,
      memberName,
      graph,
      sourceToTargets,
      usedKeys,
      new Set(),
    );
  }
};

const extractAccessedMemberNames = (
  memberAccesses: MemberAccess[],
  objectName: string,
): string[] => {
  const memberNames: string[] = [];
  const seenNames = new Set<string>();
  for (const access of memberAccesses) {
    if (access.objectName === objectName && !seenNames.has(access.memberName)) {
      seenNames.add(access.memberName);
      memberNames.push(access.memberName);
    }
  }
  return memberNames;
};

const buildSourceToTargetsMap = (
  graph: DependencyGraph,
  platformSiblingIndex: ReadonlyMap<number, ReadonlyArray<number>>,
): Map<number, ReExportTarget[]> => {
  const sourceToTargets = new Map<number, ReExportTarget[]>();

  for (const edge of graph.edges) {
    if (!edge.isReExportEdge) continue;
    for (const targetIndex of platformSiblingIndex.get(edge.target) ?? [edge.target]) {
      const existing = sourceToTargets.get(edge.source);
      if (existing) {
        existing.push({ targetIndex, mappings: edge.reExportMappings });
      } else {
        sourceToTargets.set(edge.source, [{ targetIndex, mappings: edge.reExportMappings }]);
      }
    }
  }

  return sourceToTargets;
};

const markAllExportsUsedRecursive = (
  module: SourceModule,
  graph: DependencyGraph,
  sourceToTargets: Map<number, ReExportTarget[]>,
  usedKeys: Set<string>,
  visited: Set<string>,
): void => {
  const visitKey = `all::${module.fileId.path}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  for (const exportInfo of module.exports) {
    if (exportInfo.name === "*" && exportInfo.isNamespaceReExport) continue;

    const usageKey = `${module.fileId.path}::${exportInfo.name}`;
    usedKeys.add(usageKey);

    if (exportInfo.isReExport && exportInfo.reExportSource) {
      followReExportChain(
        module.fileId.index,
        exportInfo,
        graph,
        sourceToTargets,
        usedKeys,
        visited,
      );
    }
  }
};

const markExportUsedRecursive = (
  filePath: string,
  exportName: string,
  graph: DependencyGraph,
  sourceToTargets: Map<number, ReExportTarget[]>,
  usedKeys: Set<string>,
  visited: Set<string>,
): void => {
  const visitKey = `${filePath}::${exportName}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  usedKeys.add(visitKey);

  const moduleIndex = graph.fileIdMap.get(filePath);
  if (moduleIndex === undefined) return;

  const module = graph.modules[moduleIndex];
  if (!module) return;

  for (const exportInfo of module.exports) {
    if (exportInfo.name !== exportName) continue;

    if (exportInfo.isReExport && exportInfo.reExportSource) {
      followReExportChain(moduleIndex, exportInfo, graph, sourceToTargets, usedKeys, visited);
    }
  }
};

const followReExportChain = (
  reExporterModuleIndex: number,
  exportInfo: ExportReference,
  graph: DependencyGraph,
  sourceToTargets: Map<number, ReExportTarget[]>,
  usedKeys: Set<string>,
  visited: Set<string>,
): void => {
  const targetIndices = sourceToTargets.get(reExporterModuleIndex);
  if (!targetIndices) return;

  const originalName = exportInfo.reExportOriginalName ?? exportInfo.name;

  for (const target of targetIndices) {
    const hasMatchingMapping = target.mappings.some(
      (mapping) =>
        (mapping.exportedName === exportInfo.name && mapping.originalName === originalName) ||
        (exportInfo.isSynthetic && mapping.exportedName === "*" && mapping.originalName === "*"),
    );
    if (!hasMatchingMapping) continue;

    const targetModule = graph.modules[target.targetIndex];
    if (!targetModule) continue;

    if (originalName === "*" || exportInfo.isNamespaceReExport) {
      markAllExportsUsedRecursive(targetModule, graph, sourceToTargets, usedKeys, visited);
    } else {
      const targetHasExport = targetModule.exports.some(
        (targetExport) =>
          targetExport.name === originalName ||
          (targetExport.isNamespaceReExport && targetExport.name === "*"),
      );

      if (targetHasExport) {
        markExportUsedRecursive(
          targetModule.fileId.path,
          originalName,
          graph,
          sourceToTargets,
          usedKeys,
          visited,
        );
      }
    }
  }
};
