import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const isReferenceStableAcrossFunctionExecutions = (
  expression: EsTreeNode,
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    (!isNodeOfType(candidate, "Identifier") && !isNodeOfType(candidate, "MemberExpression")) ||
    !resolveExpressionKey(candidate, context)
  ) {
    return false;
  }
  let referencesFunctionBinding = false;
  walkAst(candidate, (descendant) => {
    if (!isNodeOfType(descendant, "Identifier")) return;
    const reference = context.scopes.referenceFor(descendant);
    if (
      reference?.resolvedSymbol &&
      (isAstDescendant(reference.resolvedSymbol.bindingIdentifier, functionNode) ||
        reference.resolvedSymbol.references.some(
          (symbolReference) =>
            symbolReference.flag !== "read" &&
            isAstDescendant(symbolReference.identifier, functionNode),
        ))
    ) {
      referencesFunctionBinding = true;
      return false;
    }
  });
  return !referencesFunctionBinding;
};
