import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const hasUnstableLocalMemberSource = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "MemberExpression")) return false;
  const object = stripParenExpression(candidate.object);
  if (isNodeOfType(object, "MemberExpression")) {
    return hasUnstableLocalMemberSource(object, context);
  }
  if (!isNodeOfType(object, "Identifier")) return false;
  const propertyName = getStaticPropertyName(candidate);
  const symbol = context.scopes.symbolFor(object);
  const initializer = symbol?.initializer ? stripParenExpression(symbol.initializer) : null;
  if (!propertyName || !initializer || !isNodeOfType(initializer, "ObjectExpression")) {
    return false;
  }
  const propertyValue = getStaticObjectPropertyValue(initializer, propertyName);
  return propertyValue === null || propertyValue === undefined;
};

export const isReferenceStableAcrossFunctionExecutions = (
  expression: EsTreeNode,
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    (!isNodeOfType(candidate, "Identifier") && !isNodeOfType(candidate, "MemberExpression")) ||
    !resolveExpressionKey(candidate, context) ||
    hasUnstableLocalMemberSource(candidate, context)
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
            (symbolReference.flag !== "read" ||
              isWithinAssignmentTarget(symbolReference.identifier)) &&
            isAstDescendant(symbolReference.identifier, functionNode),
        ))
    ) {
      referencesFunctionBinding = true;
      return false;
    }
  });
  return !referencesFunctionBinding;
};
