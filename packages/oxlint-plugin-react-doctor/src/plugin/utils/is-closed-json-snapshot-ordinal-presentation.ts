import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import {
  CLOSED_JSON_SNAPSHOT_LEAF_MAX_DEPTH,
  CLOSED_JSON_SNAPSHOT_ORDINAL_OPERATORS,
} from "./closed-json-snapshot-leaf/constants.js";

export const isClosedJsonSnapshotOrdinalPresentation = (
  expression: EsTreeNode,
  indexSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  depth = 0,
): boolean => {
  if (depth > CLOSED_JSON_SNAPSHOT_LEAF_MAX_DEPTH) return false;
  const unwrapped = stripParenExpression(expression);
  if (isNodeOfType(unwrapped, "Literal")) {
    return typeof unwrapped.value === "string" || typeof unwrapped.value === "number";
  }
  if (isNodeOfType(unwrapped, "Identifier")) return scopes.symbolFor(unwrapped) === indexSymbol;
  if (isNodeOfType(unwrapped, "BinaryExpression")) {
    return (
      CLOSED_JSON_SNAPSHOT_ORDINAL_OPERATORS.has(unwrapped.operator) &&
      isClosedJsonSnapshotOrdinalPresentation(unwrapped.left, indexSymbol, scopes, depth + 1) &&
      isClosedJsonSnapshotOrdinalPresentation(unwrapped.right, indexSymbol, scopes, depth + 1)
    );
  }
  if (isNodeOfType(unwrapped, "TemplateLiteral")) {
    return unwrapped.expressions.every((child) =>
      isClosedJsonSnapshotOrdinalPresentation(child, indexSymbol, scopes, depth + 1),
    );
  }
  return false;
};
