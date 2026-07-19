import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const isUseCursorCall = (node: EsTreeNode | null | undefined, scopes: ScopeAnalysis): boolean =>
  Boolean(
    node &&
    isNodeOfType(node, "CallExpression") &&
    resolveInkApiName(node.callee, scopes) === "useCursor",
  );

const getHorizontalPosition = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): EsTreeNode | null => {
  const positionNode = callExpression.arguments[0];
  if (!positionNode) return null;
  if (!isNodeOfType(positionNode, "ObjectExpression")) return positionNode;
  const horizontalProperty = positionNode.properties.find(
    (propertyNode) =>
      isNodeOfType(propertyNode, "Property") &&
      getStaticPropertyKeyName(propertyNode, { allowComputedString: true }) === "x",
  );
  return horizontalProperty && isNodeOfType(horizontalProperty, "Property")
    ? horizontalProperty.value
    : null;
};

const isProvablyAsciiString = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) {
    return typeof expression.value === "string" && /^[\x20-\x7e]*$/.test(expression.value);
  }
  if (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0) {
    const value = expression.quasis[0]?.value.cooked ?? expression.quasis[0]?.value.raw ?? "";
    return /^[\x20-\x7e]*$/.test(value);
  }
  if (
    isNodeOfType(expression, "BinaryExpression") &&
    expression.operator === "+" &&
    isProvablyAsciiString(expression.left, scopes, visitedSymbolIds) &&
    isProvablyAsciiString(expression.right, scopes, visitedSymbolIds)
  ) {
    return true;
  }
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (!initializer) return false;
  visitedSymbolIds.add(symbol.id);
  return isProvablyAsciiString(initializer, scopes, visitedSymbolIds);
};

export const inkUseStringWidthForCursor = defineRule({
  id: "ink-use-string-width-for-cursor",
  title: "String length used as terminal column width",
  severity: "warn",
  minimumInkVersion: MINIMUM_INK_VERSIONS.cursor,
  recommendation:
    "Measure terminal columns with `string-width` before calling `setCursorPosition`.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (getStaticPropertyName(node.callee) !== "setCursorPosition") return;
      const cursorObject = stripParenExpression(node.callee.object);
      const isCursor =
        isUseCursorCall(cursorObject, context.scopes) ||
        (isNodeOfType(cursorObject, "Identifier") &&
          isUseCursorCall(context.scopes.symbolFor(cursorObject)?.initializer, context.scopes));
      if (!isCursor) return;
      const horizontalPosition = getHorizontalPosition(node);
      if (
        !isNodeOfType(horizontalPosition, "MemberExpression") ||
        getStaticPropertyName(horizontalPosition) !== "length"
      ) {
        return;
      }
      if (isProvablyAsciiString(horizontalPosition.object, context.scopes)) return;
      context.report({
        node: horizontalPosition,
        message: "JavaScript string length is not a terminal column width for Unicode text.",
      });
    },
  }),
});
