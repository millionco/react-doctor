import type { EsTreeNode } from "./es-tree-node.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { getInkJsxTreeIndex } from "./get-ink-jsx-tree-index.js";

export const containsInkJsxElement = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  getInkJsxTreeIndex(node, scopes).nodesContainingInk.has(node);
