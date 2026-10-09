import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isPrimitiveAccumulator = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = scopes.symbolFor(identifier);
  if (
    !symbol ||
    !isNodeOfType(symbol.initializer, "Literal") ||
    typeof symbol.initializer.value !== "number" ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  )
    return false;
  return symbol.references.every((reference) => {
    if (reference.flag === "read") return true;
    const assignment = reference.identifier.parent;
    return (
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.left === reference.identifier &&
      assignment.operator === "+="
    );
  });
};
