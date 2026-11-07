import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isClosedJsonSnapshotStateKeyCount = (
  expression: EsTreeNode,
  state: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    expression.optional ||
    getStaticPropertyName(expression) !== "length"
  )
    return false;
  const keys = expression.object;
  if (
    !isNodeOfType(keys, "CallExpression") ||
    keys.optional ||
    keys.arguments.length !== 1 ||
    !isNodeOfType(keys.callee, "MemberExpression") ||
    keys.callee.optional ||
    getStaticPropertyName(keys.callee) !== "keys" ||
    !isNodeOfType(keys.callee.object, "Identifier") ||
    keys.callee.object.name !== "Object" ||
    !scopes.isGlobalReference(keys.callee.object)
  )
    return false;
  const argument = keys.arguments[0];
  return isNodeOfType(argument, "Identifier") && scopes.symbolFor(argument) === state;
};
