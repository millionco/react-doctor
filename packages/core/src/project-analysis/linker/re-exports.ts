import type { DependencyGraph } from "../types.js";

export const resolveReExportChains = (graph: DependencyGraph): void => {
  const sourceToWildcardTargets = buildSourceWildcardTargetMap(graph);
  const maxIterations = graph.modules.length * 2 + 1;
  let didChange = true;
  let iterationCount = 0;

  while (didChange && iterationCount < maxIterations) {
    didChange = false;
    iterationCount++;

    for (const module of graph.modules) {
      const namespaceReExport = module.exports.find(
        (exportInfo) =>
          exportInfo.isReExport &&
          exportInfo.reExportSource !== undefined &&
          exportInfo.isNamespaceReExport,
      );
      if (!namespaceReExport) continue;

      const targetIndices = sourceToWildcardTargets.get(module.fileId.index);
      if (!targetIndices) continue;
      const existingExportNames = new Set(
        module.exports
          .filter((exportInfo) => !exportInfo.isNamespaceReExport)
          .map((exportInfo) => exportInfo.name),
      );

      for (const targetIndex of targetIndices) {
        const targetModule = graph.modules[targetIndex];
        if (!targetModule) continue;

        for (const targetExport of targetModule.exports) {
          if (targetExport.name === "*" && targetExport.isNamespaceReExport) continue;
          if (existingExportNames.has(targetExport.name)) continue;
          existingExportNames.add(targetExport.name);
          module.exports.push({
            name: targetExport.name,
            isDefault: targetExport.isDefault,
            isTypeOnly: targetExport.isTypeOnly || namespaceReExport.isTypeOnly,
            isReExport: true,
            isSynthetic: true,
            reExportSource: namespaceReExport.reExportSource,
            reExportOriginalName: targetExport.name,
            isNamespaceReExport: false,
            line: namespaceReExport.line,
            column: namespaceReExport.column,
          });
          didChange = true;
        }
      }
    }
  }
};

const buildSourceWildcardTargetMap = (graph: DependencyGraph): Map<number, number[]> => {
  const sourceTargets = new Map<number, number[]>();

  for (const edge of graph.edges) {
    if (!edge.isReExportEdge || !edge.reExportedNames.includes("*")) continue;
    const existing = sourceTargets.get(edge.source);
    if (existing) {
      if (!existing.includes(edge.target)) {
        existing.push(edge.target);
      }
    } else {
      sourceTargets.set(edge.source, [edge.target]);
    }
  }

  return sourceTargets;
};
