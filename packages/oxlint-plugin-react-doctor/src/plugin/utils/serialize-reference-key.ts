import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface SerializeReferenceKeyInput {
  node: EsTreeNode;
  scopes?: ScopeAnalysis;
}

export const serializeReferenceKey = ({
  node,
  scopes,
}: SerializeReferenceKeyInput): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes?.symbolFor(expression);
    return symbol ? `${expression.name}#${symbol.id}` : expression.name;
  }
  if (isNodeOfType(expression, "ThisExpression")) return "this";
  if (!isNodeOfType(expression, "MemberExpression")) return null;
  const receiverKey = serializeReferenceKey({ node: expression.object, scopes });
  const propertyName = getStaticPropertyName(expression);
  return receiverKey && propertyName ? `${receiverKey}.${propertyName}` : null;
};
