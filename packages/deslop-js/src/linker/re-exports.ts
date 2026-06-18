import type { DependencyGraph } from "../types.js";

export const resolveReExportChains = (graph: DependencyGraph): void => {
  const sourceToTargets = buildSourceTargetMap(graph);
  const maxIterations = graph.modules.length * 2 + 1;
  let didChange = true;
  let iterationCount = 0;

  while (didChange && iterationCount < maxIterations) {
    didChange = false;
    iterationCount++;

    for (const module of graph.modules) {
      const originalExportCount = module.exports.length;

      for (let exportIndex = 0; exportIndex < originalExportCount; exportIndex++) {
        const exportInfo = module.exports[exportIndex];
        if (!exportInfo.isReExport || !exportInfo.reExportSource) continue;
        if (!exportInfo.isNamespaceReExport) continue;

        const targetIndices = sourceToTargets.get(module.fileId.index);
        if (!targetIndices) continue;

        for (const targetIndex of targetIndices) {
          const targetModule = graph.modules[targetIndex];
          if (!targetModule) continue;

          for (const targetExport of targetModule.exports) {
            if (targetExport.name === "*" && targetExport.isNamespaceReExport) continue;

            const isDuplicate = module.exports.some(
              (existingExport) =>
                existingExport.name === targetExport.name && !existingExport.isNamespaceReExport,
            );

            if (!isDuplicate) {
              module.exports.push({
                name: targetExport.name,
                isDefault: targetExport.isDefault,
                isTypeOnly: targetExport.isTypeOnly || exportInfo.isTypeOnly,
                isReExport: true,
                isSynthetic: true,
                reExportSource: exportInfo.reExportSource,
                reExportOriginalName: targetExport.name,
                isNamespaceReExport: false,
                line: exportInfo.line,
                column: exportInfo.column,
              });
              didChange = true;
            }
          }
        }
      }
    }
  }
};

const buildSourceTargetMap = (graph: DependencyGraph): Map<number, number[]> => {
  const sourceTargets = new Map<number, number[]>();

  for (const edge of graph.edges) {
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
