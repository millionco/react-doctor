import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { containsInkJsxElement } from "./contains-ink-jsx-element.js";
import { findNearestInkJsxElement } from "./find-nearest-ink-jsx-element.js";

export const isInsideInkJsxTree = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    node &&
    (findNearestInkJsxElement(node, scopes) !== null || containsInkJsxElement(node, scopes)),
  );
