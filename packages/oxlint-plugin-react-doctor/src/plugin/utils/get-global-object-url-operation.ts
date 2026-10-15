import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getGlobalObjectUrlOperation = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): string | null => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  if (methodName !== "createObjectURL" && methodName !== "revokeObjectURL") return null;
  const receiver = stripParenExpression(callee.object);
  if (isNodeOfType(receiver, "Identifier")) {
    return receiver.name === "URL" && scopes.isGlobalReference(receiver) ? methodName : null;
  }
  if (!isNodeOfType(receiver, "MemberExpression") || getStaticPropertyName(receiver) !== "URL") {
    return null;
  }
  const globalReceiver = stripParenExpression(receiver.object);
  if (!isNodeOfType(globalReceiver, "Identifier") || !scopes.isGlobalReference(globalReceiver)) {
    return null;
  }
  return globalReceiver.name === "window" ||
    globalReceiver.name === "globalThis" ||
    globalReceiver.name === "self"
    ? methodName
    : null;
};
