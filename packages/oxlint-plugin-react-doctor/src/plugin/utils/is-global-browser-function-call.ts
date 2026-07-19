import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isGlobalBrowserFunctionCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  functionName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return callee.name === functionName && scopes.isGlobalReference(callee);
  }
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== functionName) {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    (receiver.name === "globalThis" || receiver.name === "window") &&
    scopes.isGlobalReference(receiver)
  );
};
