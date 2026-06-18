import type {
  DependencyGraph,
  SourceModule,
  ExportReference,
  UnusedExport,
  DeslopConfig,
  MemberAccess,
} from "../types.js";

export const detectDeadExports = (graph: DependencyGraph, config: DeslopConfig): UnusedExport[] => {
  const usageMap = buildUsageMap(graph);
  const unusedExports: UnusedExport[] = [];

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (module.isGitIgnored) continue;
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

      if (module.localIdentifierReferences.includes(exportInfo.name)) continue;

      if (!exportInfo.isDefault && defaultExportLinkedNames.has(exportInfo.name)) {
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

const buildUsageMap = (graph: DependencyGraph): Set<string> => {
  const usedExportKeys = new Set<string>();
  const sourceToTargetMap = buildSourceToTargetsMap(graph);

  for (const module of graph.modules) {
    if (!module.isEntryPoint) continue;

    for (const edge of graph.edges) {
      if (edge.source !== module.fileId.index || !edge.isReExportEdge) continue;
      const targetModule = graph.modules[edge.target];
      if (!targetModule) continue;

      const isWildcardReExport = edge.reExportedNames.includes("*");
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

  for (const edge of graph.edges) {
    const targetModule = graph.modules[edge.target];
    if (!targetModule) continue;

    const sourceModule = graph.modules[edge.source];

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
          const hasDefaultExport = targetModule.exports.some((exportInfo) => exportInfo.isDefault);
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

  return usedExportKeys;
};

const handleNamespaceImport = (
  sourceModule: SourceModule | undefined,
  targetModule: SourceModule,
  namespaceLocalName: string,
  graph: DependencyGraph,
  sourceToTargets: Map<number, number[]>,
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

  if (isNamespaceReExported && !sourceModule.isEntryPoint) {
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

const buildSourceToTargetsMap = (graph: DependencyGraph): Map<number, number[]> => {
  const sourceToTargets = new Map<number, number[]>();

  for (const edge of graph.edges) {
    const existing = sourceToTargets.get(edge.source);
    if (existing) {
      if (!existing.includes(edge.target)) {
        existing.push(edge.target);
      }
    } else {
      sourceToTargets.set(edge.source, [edge.target]);
    }
  }

  return sourceToTargets;
};

const markAllExportsUsedRecursive = (
  module: SourceModule,
  graph: DependencyGraph,
  sourceToTargets: Map<number, number[]>,
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
  sourceToTargets: Map<number, number[]>,
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
  sourceToTargets: Map<number, number[]>,
  usedKeys: Set<string>,
  visited: Set<string>,
): void => {
  const targetIndices = sourceToTargets.get(reExporterModuleIndex);
  if (!targetIndices) return;

  const originalName = exportInfo.reExportOriginalName ?? exportInfo.name;

  for (const targetIndex of targetIndices) {
    const targetModule = graph.modules[targetIndex];
    if (!targetModule) continue;

    if (originalName === "*" || exportInfo.isNamespaceReExport) {
      markExportUsedRecursive(
        targetModule.fileId.path,
        exportInfo.name,
        graph,
        sourceToTargets,
        usedKeys,
        visited,
      );
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
