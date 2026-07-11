import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import { executesDuringRender } from "./executes-during-render.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const findRenderPhaseComponentOrHook = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  let functionNode = findEnclosingFunction(node);
  while (functionNode) {
    if (componentOrHookDisplayNameForFunction(functionNode)) return functionNode;
    if (!executesDuringRender(functionNode, scopes)) return null;
    functionNode = findEnclosingFunction(functionNode);
  }
  return null;
};
