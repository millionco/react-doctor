import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { flattenLogicalAndChain } from "./flatten-logical-and-chain.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPresenceProvenBeforeNode } from "./is-presence-proven-before-node.js";
import { isRuntimeGlobalReference } from "./is-runtime-global-reference.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import type { RuleContext } from "./rule-context.js";
import { stripGroupingParens } from "./strip-grouping-parens.js";
import { walkAst } from "./walk-ast.js";

interface RuntimeStringGuardedLeafInput {
  element: EsTreeNodeOfType<"JSXElement">;
  callback: EsTreeNode | null;
  indexParameterPosition: number | null;
  context: RuleContext;
}

export const isRuntimeStringGuardedLeaf = ({
  element,
  callback,
  indexParameterPosition,
  context,
}: RuntimeStringGuardedLeafInput): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    findEnclosingFunction(element) !== callback ||
    indexParameterPosition === null ||
    indexParameterPosition < 1
  )
    return false;
  const tokenParameter = callback.params[0];
  if (!isNodeOfType(tokenParameter, "Identifier")) return false;
  const tokenSymbol = context.scopes.symbolFor(tokenParameter);
  if (!tokenSymbol) return false;
  const indexParameter = callback.params[indexParameterPosition];
  const indexIdentifier = isNodeOfType(indexParameter, "AssignmentPattern")
    ? indexParameter.left
    : indexParameter;
  if (!isNodeOfType(indexIdentifier, "Identifier")) return false;
  const indexSymbol = context.scopes.symbolFor(indexIdentifier);
  if (!indexSymbol) return false;
  if (
    [tokenSymbol, indexSymbol].some(
      (bindingSymbol) =>
        !isSymbolReadOnly(bindingSymbol) ||
        bindingSymbol.references.some((reference) =>
          isWithinAssignmentTarget(reference.identifier),
        ),
    )
  )
    return false;
  if (
    !element.openingElement.attributes.every((attribute) => {
      if (!isNodeOfType(attribute, "JSXAttribute")) return false;
      if (attribute.name.name === "key") {
        if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
        const keyExpression = stripGroupingParens(attribute.value.expression);
        return (
          isNodeOfType(keyExpression, "Identifier") &&
          context.scopes.symbolFor(keyExpression) === indexSymbol
        );
      }
      if (attribute.name.name !== "className" || !attribute.value) return false;
      const value = isNodeOfType(attribute.value, "JSXExpressionContainer")
        ? attribute.value.expression
        : attribute.value;
      return isNodeOfType(value, "Literal") && typeof value.value === "string";
    })
  )
    return false;
  let hasTokenChild = false;
  if (
    !element.children.every((child) => {
      if (isNodeOfType(child, "JSXText")) return true;
      if (!isNodeOfType(child, "JSXExpressionContainer")) return false;
      const expression = stripGroupingParens(child.expression);
      if (
        isNodeOfType(expression, "Identifier") &&
        context.scopes.symbolFor(expression) === tokenSymbol
      ) {
        hasTokenChild = true;
        return true;
      }
      return (
        isNodeOfType(expression, "Literal") &&
        (expression.value === null ||
          ["string", "number", "boolean"].includes(typeof expression.value))
      );
    }) ||
    !hasTokenChild
  )
    return false;
  let hasDynamicBinding = false;
  walkAst(callback.body, (node) => {
    if (hasDynamicBinding) return false;
    if (isNodeOfType(node, "WithStatement")) hasDynamicBinding = true;
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "eval"
    ) {
      hasDynamicBinding = isRuntimeGlobalReference(node.callee, context.scopes);
    }
  });
  if (hasDynamicBinding) return false;
  return isPresenceProvenBeforeNode(element, (test) =>
    flattenLogicalAndChain(stripGroupingParens(test)).some((operand) => {
      const comparison = stripGroupingParens(operand);
      if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "===")
        return false;
      const [typeExpression, stringExpression] = isNodeOfType(comparison.left, "UnaryExpression")
        ? [comparison.left, comparison.right]
        : [comparison.right, comparison.left];
      return (
        isNodeOfType(stringExpression, "Literal") &&
        stringExpression.value === "string" &&
        isNodeOfType(typeExpression, "UnaryExpression") &&
        typeExpression.operator === "typeof" &&
        isNodeOfType(stripGroupingParens(typeExpression.argument), "Identifier") &&
        context.scopes.symbolFor(stripGroupingParens(typeExpression.argument)) === tokenSymbol
      );
    }),
  );
};
