import type { DependencyGraph, ReExportCycle } from "../types.js";
import { findStronglyConnectedComponents } from "../utils/find-strongly-connected-components.js";

/**
 * Reports cycles in the subgraph of `isReExportEdge` edges only. These are
 * a strict subset of `circularDependencies` but worth separating: every
 * general cycle can have a legitimate bidirectional-collaboration reason,
 * but a re-export cycle has none — it always tanks tree-shaking and risks
 * the "Cannot access X before initialization" TDZ runtime error.
 */
export const detectReExportCycles = (graph: DependencyGraph): ReExportCycle[] => {
  const adjacency: number[][] = Array.from({ length: graph.modules.length }, () => []);
  const reExportTargetSets: Set<number>[] = Array.from(
    { length: graph.modules.length },
    () => new Set(),
  );

  for (const edge of graph.edges) {
    if (!edge.isReExportEdge) continue;
    if (edge.target >= graph.modules.length) continue;
    if (reExportTargetSets[edge.source].has(edge.target)) continue;
    reExportTargetSets[edge.source].add(edge.target);
    adjacency[edge.source].push(edge.target);
  }

  const sccComponents = findStronglyConnectedComponents(adjacency);
  const findings: ReExportCycle[] = [];

  for (const component of sccComponents) {
    if (component.length === 1) {
      const onlyNode = component[0];
      const hasSelfLoop = adjacency[onlyNode].includes(onlyNode);
      if (!hasSelfLoop) continue;
      const filePath = graph.modules[onlyNode].fileId.path;
      findings.push({
        files: [filePath],
        kind: "self-loop",
        confidence: "high",
        reason: `${filePath} re-exports from itself — the barrel imports its own root, which breaks bundler tree-shaking and risks TDZ runtime errors`,
      });
      continue;
    }

    const sortedFiles = component
      .map((moduleIndex) => graph.modules[moduleIndex].fileId.path)
      .sort();
    findings.push({
      files: sortedFiles,
      kind: "multi-node",
      confidence: "high",
      reason: `${sortedFiles.length} modules form a re-export cycle — refactor consumers to import from the leaf module instead of the barrel`,
    });
  }

  findings.sort((firstFinding, secondFinding) =>
    firstFinding.files[0].localeCompare(secondFinding.files[0]),
  );
  return findings;
};
