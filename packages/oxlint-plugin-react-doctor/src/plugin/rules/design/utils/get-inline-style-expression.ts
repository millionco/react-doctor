import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const isConstObjectBindingMutated = (symbol: SymbolDescriptor): boolean =>
  symbol.references.some((reference) => {
    if (reference.flag !== "read") return true;
    let referenceExpression: EsTreeNode = reference.identifier;
    while (
      referenceExpression.parent &&
      isNodeOfType(referenceExpression.parent, "MemberExpression") &&
      referenceExpression.parent.object === referenceExpression
    ) {
      referenceExpression = referenceExpression.parent;
    }
    const parent = referenceExpression.parent;
    return Boolean(
      (isNodeOfType(parent, "AssignmentExpression") && parent.left === referenceExpression) ||
      (isNodeOfType(parent, "UpdateExpression") && parent.argument === referenceExpression) ||
      (isNodeOfType(parent, "UnaryExpression") &&
        parent.operator === "delete" &&
        parent.argument === referenceExpression) ||
      (isNodeOfType(parent, "CallExpression") &&
        parent.arguments?.some((argument) => argument === referenceExpression)),
    );
  });

const resolveInlineStyleObjectExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis | undefined,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ObjectExpression")) return candidate;
  if (!scopes || !isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    isConstObjectBindingMutated(symbol)
  ) {
    return null;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return resolveInlineStyleObjectExpression(symbol.initializer, scopes, nextVisitedSymbolIds);
};

export const getInlineStyleExpression = (
  node: EsTreeNodeOfType<"JSXAttribute">,
  scopes?: ScopeAnalysis,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "style") return null;
  if (!isNodeOfType(node.value, "JSXExpressionContainer")) return null;
  return resolveInlineStyleObjectExpression(node.value.expression, scopes);
};
