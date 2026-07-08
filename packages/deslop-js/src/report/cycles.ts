import type { DependencyGraph, CircularDependency, Edge } from "../types.js";
import {
  MAX_CYCLES_PER_SCC,
  MAX_TOTAL_CYCLES,
  MAX_SCC_SIZE_FOR_ENUMERATION,
} from "../constants.js";

const UNDEFINED_INDEX = -1;

interface TarjanState {
  indexCounter: number;
  indices: number[];
  lowlinks: number[];
  onStack: boolean[];
  stack: number[];
}

interface DfsFrame {
  node: number;
  successorPosition: number;
}

// A value-form import (`import { Props } from "./barrel"`) whose every
// symbol resolves to a type-only export (interface / type alias) in the
// target module is erased by the TS compiler exactly like `import type`,
// so it cannot participate in a runtime initialization cycle. Symbols the
// target doesn't list by name (namespace imports, `export *` barrels) stay
// conservative: the edge is kept.
const isCompileTimeErasedEdge = (edge: Edge, graph: DependencyGraph): boolean => {
  if (edge.isReExportEdge) return false;
  if (edge.importedSymbols.length === 0) return false;
  const targetModule = graph.modules[edge.target];
  if (!targetModule) return false;
  return edge.importedSymbols.every((symbol) => {
    if (symbol.isTypeOnly) return true;
    if (symbol.isNamespace) return false;
    const exportName = symbol.isDefault ? "default" : symbol.importedName;
    const matchingExports = targetModule.exports.filter(
      (exportInfo) => exportInfo.name === exportName,
    );
    return (
      matchingExports.length > 0 && matchingExports.every((exportInfo) => exportInfo.isTypeOnly)
    );
  });
};

const buildAdjacencyList = (graph: DependencyGraph): number[][] => {
  const targetSets: Set<number>[] = Array.from({ length: graph.modules.length }, () => new Set());

  for (const edge of graph.edges) {
    // A lazy `import()` / `require()` edge only evaluates at call time, after
    // module init, so it cannot close an initialization-order cycle.
    if (edge.isDynamic) {
      continue;
    }

    const isTypeOnlyEdge = edge.importedSymbols.every((symbol) => symbol.isTypeOnly);
    if (isTypeOnlyEdge) {
      continue;
    }

    if (isCompileTimeErasedEdge(edge, graph)) {
      continue;
    }

    if (edge.target < graph.modules.length) {
      targetSets[edge.source].add(edge.target);
    }
  }

  return targetSets.map((targets) => [...targets]);
};

// Edges whose source module dereferences an imported binding from the edge's
// target at MODULE INIT time (top-level value position). A cycle with no such
// edge can never observe a partially initialized export — every back-edge
// value is only touched inside function bodies that run after init — so the
// documented hazard cannot occur and the cycle is suppressed.
const buildModuleInitAccessEdgeSet = (graph: DependencyGraph): Set<string> => {
  const initAccessEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.isDynamic || edge.isReExportEdge) continue;
    const sourceModule = graph.modules[edge.source];
    const topLevelReferences = sourceModule?.topLevelImportReferences;
    if (!topLevelReferences || topLevelReferences.length === 0) continue;
    const hasInitAccess = edge.importedSymbols.some(
      (symbol) => !symbol.isTypeOnly && topLevelReferences.includes(symbol.localName),
    );
    if (hasInitAccess) initAccessEdges.add(`${edge.source}:${edge.target}`);
  }
  return initAccessEdges;
};

const cycleHasModuleInitAccess = (cycle: number[], initAccessEdges: Set<string>): boolean => {
  for (let position = 0; position < cycle.length; position++) {
    const source = cycle[position];
    const target = cycle[(position + 1) % cycle.length];
    if (initAccessEdges.has(`${source}:${target}`)) return true;
  }
  return false;
};

const findStronglyConnectedComponents = (adjacencyList: number[][]): number[][] => {
  const nodeCount = adjacencyList.length;
  if (nodeCount === 0) {
    return [];
  }

  const state: TarjanState = {
    indexCounter: 0,
    indices: Array(nodeCount).fill(UNDEFINED_INDEX),
    lowlinks: Array(nodeCount).fill(0),
    onStack: Array(nodeCount).fill(false),
    stack: [],
  };

  const components: number[][] = [];
  const dfsStack: DfsFrame[] = [];

  for (let startNode = 0; startNode < nodeCount; startNode++) {
    if (state.indices[startNode] !== UNDEFINED_INDEX) {
      continue;
    }

    state.indices[startNode] = state.indexCounter;
    state.lowlinks[startNode] = state.indexCounter;
    state.indexCounter++;
    state.onStack[startNode] = true;
    state.stack.push(startNode);

    dfsStack.push({ node: startNode, successorPosition: 0 });

    while (dfsStack.length > 0) {
      const frame = dfsStack[dfsStack.length - 1];
      const successors = adjacencyList[frame.node];

      if (frame.successorPosition < successors.length) {
        const successor = successors[frame.successorPosition];
        frame.successorPosition++;

        if (state.indices[successor] === UNDEFINED_INDEX) {
          state.indices[successor] = state.indexCounter;
          state.lowlinks[successor] = state.indexCounter;
          state.indexCounter++;
          state.onStack[successor] = true;
          state.stack.push(successor);

          dfsStack.push({ node: successor, successorPosition: 0 });
        } else if (state.onStack[successor]) {
          state.lowlinks[frame.node] = Math.min(
            state.lowlinks[frame.node],
            state.indices[successor],
          );
        }
      } else {
        const currentNode = frame.node;
        const currentLowlink = state.lowlinks[currentNode];
        const currentIndex = state.indices[currentNode];
        dfsStack.pop();

        if (dfsStack.length > 0) {
          const parentFrame = dfsStack[dfsStack.length - 1];
          state.lowlinks[parentFrame.node] = Math.min(
            state.lowlinks[parentFrame.node],
            currentLowlink,
          );
        }

        if (currentLowlink === currentIndex) {
          const component: number[] = [];
          let poppedNode: number;
          do {
            poppedNode = state.stack.pop()!;
            state.onStack[poppedNode] = false;
            component.push(poppedNode);
          } while (poppedNode !== currentNode);

          if (component.length >= 2) {
            components.push(component);
          }
        }
      }
    }
  }

  return components;
};

const canonicalizeCycle = (cycle: number[], graph: DependencyGraph): number[] => {
  if (cycle.length === 0) {
    return [];
  }

  let minPosition = 0;
  let minPath = graph.modules[cycle[0]].fileId.path;

  for (let position = 1; position < cycle.length; position++) {
    const currentPath = graph.modules[cycle[position]].fileId.path;
    if (currentPath < minPath) {
      minPath = currentPath;
      minPosition = position;
    }
  }

  return [...cycle.slice(minPosition), ...cycle.slice(0, minPosition)];
};

const enumerateElementaryCycles = (
  componentNodes: number[],
  adjacencyList: number[][],
  graph: DependencyGraph,
): number[][] => {
  if (componentNodes.length === 2) {
    const [nodeA, nodeB] = componentNodes;
    const sortedCycle =
      graph.modules[nodeA].fileId.path <= graph.modules[nodeB].fileId.path
        ? [nodeA, nodeB]
        : [nodeB, nodeA];
    return [sortedCycle];
  }

  const componentSet = new Set(componentNodes);
  const cycles: number[][] = [];
  const seenKeys = new Set<string>();

  for (const startNode of componentNodes) {
    if (cycles.length >= MAX_CYCLES_PER_SCC) {
      break;
    }

    const visitedInThisSearch = new Set<number>();
    visitedInThisSearch.add(startNode);

    const pathStack: number[] = [startNode];
    const successorPositionStack: number[] = [0];

    while (pathStack.length > 0 && cycles.length < MAX_CYCLES_PER_SCC) {
      const currentNode = pathStack[pathStack.length - 1];
      const currentSuccessorPosition = successorPositionStack[successorPositionStack.length - 1];
      const successors = adjacencyList[currentNode].filter((successor) =>
        componentSet.has(successor),
      );

      if (currentSuccessorPosition < successors.length) {
        successorPositionStack[successorPositionStack.length - 1]++;
        const successor = successors[currentSuccessorPosition];

        if (successor === startNode) {
          const canonical = canonicalizeCycle([...pathStack], graph);
          const key = canonical.join(",");
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            cycles.push(canonical);
          }
        } else if (!visitedInThisSearch.has(successor)) {
          visitedInThisSearch.add(successor);
          pathStack.push(successor);
          successorPositionStack.push(0);
        }
      } else {
        visitedInThisSearch.delete(pathStack.pop()!);
        successorPositionStack.pop();
      }
    }
  }

  return cycles;
};

export const detectCycles = (graph: DependencyGraph): CircularDependency[] => {
  const adjacencyList = buildAdjacencyList(graph);
  const initAccessEdges = buildModuleInitAccessEdgeSet(graph);
  const components = findStronglyConnectedComponents(adjacencyList);
  const allCycles: number[][] = [];
  const seenKeys = new Set<string>();

  const sortedComponents = [...components].sort(
    (componentA, componentB) => componentA.length - componentB.length,
  );

  for (const component of sortedComponents) {
    if (allCycles.length >= MAX_TOTAL_CYCLES) {
      break;
    }

    if (component.length > MAX_SCC_SIZE_FOR_ENUMERATION) {
      continue;
    }

    const elementaryCycles = enumerateElementaryCycles(component, adjacencyList, graph);

    for (const cycle of elementaryCycles) {
      if (!cycleHasModuleInitAccess(cycle, initAccessEdges)) continue;
      const key = cycle.join(",");
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allCycles.push(cycle);
      }
      if (allCycles.length >= MAX_TOTAL_CYCLES) {
        break;
      }
    }
  }

  allCycles.sort((cycleA, cycleB) => {
    const lengthDiff = cycleA.length - cycleB.length;
    if (lengthDiff !== 0) {
      return lengthDiff;
    }
    return graph.modules[cycleA[0]].fileId.path.localeCompare(graph.modules[cycleB[0]].fileId.path);
  });

  return allCycles.map((cycle) => ({
    files: cycle.map((nodeIndex) => graph.modules[nodeIndex].fileId.path),
  }));
};
