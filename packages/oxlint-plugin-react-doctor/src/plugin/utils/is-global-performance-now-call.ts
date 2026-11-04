import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isGlobalPerformanceNowCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callNode.arguments.length !== 0) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "performance" &&
    scopes.isGlobalReference(receiver) &&
    getStaticPropertyName(callee) === "now"
  );
};
