import type { EsTreeNode } from "./es-tree-node.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { getInkJsxTreeIndex } from "./get-ink-jsx-tree-index.js";

export const findNearestInkJsxElement = (node: EsTreeNode, scopes: ScopeAnalysis): string | null =>
  getInkJsxTreeIndex(node, scopes).nearestInkAncestorByNode.get(node) ?? null;
