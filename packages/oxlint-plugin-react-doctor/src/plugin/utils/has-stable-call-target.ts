import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasStaticPropertyWriteBefore } from "./has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const hasStableCallTarget = (callExpression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const symbol = scopes.symbolFor(callee);
    return Boolean(symbol && !hasSymbolWriteBefore(symbol, callee, scopes));
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(callee);
  const receiver = stripParenExpression(callee.object);
  return Boolean(
    propertyName &&
    isNodeOfType(receiver, "Identifier") &&
    !hasStaticPropertyWriteBefore(receiver, propertyName, callee, scopes),
  );
};
