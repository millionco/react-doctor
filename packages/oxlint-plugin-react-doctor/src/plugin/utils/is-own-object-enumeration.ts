import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isOwnObjectEnumeration = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
  method: "getOwnPropertySymbols" | "keys" = "getOwnPropertySymbols",
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional || node.arguments.length !== 1)
    return false;
  const callee = node.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Object" &&
    scopes.isGlobalReference(callee.object) &&
    getStaticPropertyKeyName(callee) === method
  );
};
