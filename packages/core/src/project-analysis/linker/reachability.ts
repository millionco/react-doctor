import type { DependencyGraph, Edge } from "../types.js";

interface ReachabilityQueueItem {
  moduleIndex: number;
  demandedSymbols: Set<string> | "all";
}

export const traceReachability = (
  graph: DependencyGraph,
  platformSiblingIndex: ReadonlyMap<number, ReadonlyArray<number>> = new Map(),
): void => {
  const totalModules = graph.modules.length;
  const visited = new Uint8Array(totalModules);
  const consumedExportsPerModule = new Map<number, Set<string>>();
  const queue: ReachabilityQueueItem[] = [];

  const outgoingEdgesMap = new Map<number, Edge[]>();
  for (const edge of graph.edges) {
    const existing = outgoingEdgesMap.get(edge.source);
    if (existing) {
      existing.push(edge);
    } else {
      outgoingEdgesMap.set(edge.source, [edge]);
    }
  }

  for (const module of graph.modules) {
    if (module.isEntryPoint) {
      const moduleIndex = module.fileId.index;
      if (moduleIndex < totalModules) {
        visited[moduleIndex] = 1;
        queue.push({ moduleIndex, demandedSymbols: "all" });
      }
    }
  }

  const markConsumedExports = (targetModuleIndex: number, symbols: Set<string> | "all"): void => {
    if (symbols === "all") {
      consumedExportsPerModule.set(targetModuleIndex, new Set(["*"]));
      return;
    }
    const existing = consumedExportsPerModule.get(targetModuleIndex);
    if (existing && existing.has("*")) return;
    if (existing) {
      for (const symbol of symbols) {
        existing.add(symbol);
      }
    } else {
      consumedExportsPerModule.set(targetModuleIndex, new Set(symbols));
    }
  };

  let headPointer = 0;
  while (headPointer < queue.length) {
    const { moduleIndex: currentIndex } = queue[headPointer++];
    const outgoingEdges = outgoingEdgesMap.get(currentIndex);
    if (!outgoingEdges) continue;

    for (const edge of outgoingEdges) {
      const targetIndex = edge.target;
      if (targetIndex >= totalModules) continue;

      if (edge.isReExportEdge) {
        if (!visited[targetIndex]) {
          visited[targetIndex] = 1;
          markConsumedExports(targetIndex, "all");
          queue.push({ moduleIndex: targetIndex, demandedSymbols: "all" });
        }
      } else {
        const importSymbolNames = new Set<string>();
        let isNamespaceOrSideEffect = edge.importedSymbols.length === 0;

        for (const symbol of edge.importedSymbols) {
          if (symbol.isNamespace) {
            isNamespaceOrSideEffect = true;
            break;
          }
          importSymbolNames.add(symbol.importedName);
          if (symbol.isDefault) {
            importSymbolNames.add("default");
          }
        }

        const symbolDemand: Set<string> | "all" = isNamespaceOrSideEffect
          ? "all"
          : importSymbolNames;

        if (!visited[targetIndex]) {
          visited[targetIndex] = 1;
          markConsumedExports(targetIndex, symbolDemand);
          queue.push({ moduleIndex: targetIndex, demandedSymbols: symbolDemand });
        } else {
          const existingConsumed = consumedExportsPerModule.get(targetIndex);
          if (symbolDemand !== "all" && existingConsumed && !existingConsumed.has("*")) {
            let hasNewSymbols = false;
            for (const symbol of symbolDemand) {
              if (!existingConsumed.has(symbol)) {
                hasNewSymbols = true;
                break;
              }
            }
            if (hasNewSymbols) {
              markConsumedExports(targetIndex, symbolDemand);
              queue.push({ moduleIndex: targetIndex, demandedSymbols: symbolDemand });
            }
          } else if (symbolDemand === "all" && (!existingConsumed || !existingConsumed.has("*"))) {
            markConsumedExports(targetIndex, "all");
            queue.push({ moduleIndex: targetIndex, demandedSymbols: "all" });
          }
        }
      }
    }
  }

  const platformQueue: ReachabilityQueueItem[] = [];
  for (let moduleIndex = 0; moduleIndex < totalModules; moduleIndex++) {
    if (!visited[moduleIndex]) continue;
    for (const siblingIndex of platformSiblingIndex.get(moduleIndex) ?? []) {
      if (!visited[siblingIndex]) {
        visited[siblingIndex] = 1;
        platformQueue.push({ moduleIndex: siblingIndex, demandedSymbols: "all" });
      }
    }
  }

  let platformHeadPointer = 0;
  while (platformHeadPointer < platformQueue.length) {
    const { moduleIndex: currentIndex } = platformQueue[platformHeadPointer++];
    const outgoingEdges = outgoingEdgesMap.get(currentIndex);
    if (!outgoingEdges) continue;

    for (const edge of outgoingEdges) {
      if (edge.target < totalModules && !visited[edge.target]) {
        visited[edge.target] = 1;
        platformQueue.push({ moduleIndex: edge.target, demandedSymbols: "all" });
      }
    }
  }

  for (let moduleIndex = 0; moduleIndex < totalModules; moduleIndex++) {
    graph.modules[moduleIndex].isReachable = Boolean(visited[moduleIndex]);
  }
};
