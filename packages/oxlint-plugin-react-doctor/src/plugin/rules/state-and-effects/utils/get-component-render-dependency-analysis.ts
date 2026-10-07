import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { buildLocalDependencyGraph } from "./build-local-dependency-graph.js";
import { collectFunctionLikeLocalNames } from "./collect-function-like-local-names.js";
import { collectRenderReachableNames } from "./collect-render-reachable-names.js";
import { expandTransitiveDependencies } from "./expand-transitive-dependencies.js";

export interface ComponentRenderDependencyAnalysis {
  readonly dependencyGraph: ReadonlyMap<string, ReadonlySet<string>>;
  readonly directRenderNames: ReadonlySet<string>;
  readonly renderReachableNames: ReadonlySet<string>;
}

const analysesByComponent = new WeakMap<
  EsTreeNode,
  WeakMap<ScopeAnalysis, ComponentRenderDependencyAnalysis>
>();

export const getComponentRenderDependencyAnalysis = (
  componentBody: EsTreeNode,
  scopes: ScopeAnalysis,
): ComponentRenderDependencyAnalysis => {
  let analysesByScope = analysesByComponent.get(componentBody);
  if (!analysesByScope) {
    analysesByScope = new WeakMap();
    analysesByComponent.set(componentBody, analysesByScope);
  }
  const cachedAnalysis = analysesByScope.get(scopes);
  if (cachedAnalysis) return cachedAnalysis;

  const eventHandlerReferenceNames = collectFunctionLikeLocalNames(componentBody, scopes);
  const dependencyGraph = buildLocalDependencyGraph(componentBody, eventHandlerReferenceNames);
  const directRenderNames = collectRenderReachableNames(
    componentBody,
    scopes,
    eventHandlerReferenceNames,
  );
  const analysis = {
    dependencyGraph,
    directRenderNames,
    renderReachableNames: expandTransitiveDependencies(directRenderNames, dependencyGraph),
  };
  analysesByScope.set(scopes, analysis);
  return analysis;
};
