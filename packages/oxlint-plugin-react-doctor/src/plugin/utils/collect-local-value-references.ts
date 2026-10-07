import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

export const collectLocalValueReferences = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNode[] => {
  const references = new Set<EsTreeNode>();
  const pendingExpressions = [expression];
  while (pendingExpressions.length > 0) {
    const pendingExpression = pendingExpressions.pop();
    if (!pendingExpression || references.has(pendingExpression)) continue;
    references.add(pendingExpression);
    const expressionRoot = findTransparentExpressionRoot(pendingExpression);
    const declarator = expressionRoot.parent;
    if (
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== expressionRoot ||
      !isNodeOfType(declarator.id, "Identifier")
    ) {
      continue;
    }
    const symbol = context.scopes.symbolFor(declarator.id);
    if (!symbol || symbol.kind !== "const") continue;
    for (const reference of symbol.references) {
      pendingExpressions.push(reference.identifier);
    }
  }
  return [...references];
};
