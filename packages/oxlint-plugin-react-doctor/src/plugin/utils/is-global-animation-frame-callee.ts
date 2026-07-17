import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isGlobalAnimationFrameCallee = (
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(callee, "Identifier")) {
    return callee.name === "requestAnimationFrame" && scopes.isGlobalReference(callee);
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (getStaticPropertyName(callee) !== "requestAnimationFrame") return false;
  return (
    isNodeOfType(callee.object, "Identifier") &&
    (callee.object.name === "window" || callee.object.name === "globalThis") &&
    scopes.isGlobalReference(callee.object)
  );
};
