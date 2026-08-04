import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import { executesDuringRender } from "./executes-during-render.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import type { EsTreeNode } from "./es-tree-node.js";

const RENDER_PHASE_OWNER_CACHE = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, EsTreeNode | null>
>();

export const findRenderPhaseComponentOrHook = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  let functionNode = findEnclosingFunction(node);
  const cacheKey = functionNode ?? node;
  let ownersByNode = RENDER_PHASE_OWNER_CACHE.get(scopes);
  if (!ownersByNode) {
    ownersByNode = new WeakMap();
    RENDER_PHASE_OWNER_CACHE.set(scopes, ownersByNode);
  }
  const cachedOwner = ownersByNode.get(cacheKey);
  if (cachedOwner !== undefined) return cachedOwner;
  while (functionNode) {
    if (componentOrHookDisplayNameForFunction(functionNode)) {
      ownersByNode.set(cacheKey, functionNode);
      return functionNode;
    }
    if (!executesDuringRender(functionNode, scopes)) {
      ownersByNode.set(cacheKey, null);
      return null;
    }
    functionNode = findEnclosingFunction(functionNode);
  }
  ownersByNode.set(cacheKey, null);
  return null;
};
