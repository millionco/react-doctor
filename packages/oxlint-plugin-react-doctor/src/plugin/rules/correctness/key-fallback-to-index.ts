import { INDEX_PARAMETER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const ITERATOR_METHOD_NAMES = new Set(["map", "flatMap", "forEach"]);

const identifierName = (node: EsTreeNode): string | null =>
  isNodeOfType(node, "Identifier") ? node.name : null;

// Name of the identifier a `?? / ||` fallback or `? :` alternate degrades to,
// or null. Chained fallbacks (`x ?? y ?? index`) recurse into the right
// operand so the FINAL operand is inspected regardless of associativity.
const extractFallbackIdentifierName = (node: EsTreeNode): string | null => {
  const stripped = stripParenExpression(node);

  if (
    isNodeOfType(stripped, "LogicalExpression") &&
    (stripped.operator === "??" || stripped.operator === "||")
  ) {
    const right = stripParenExpression(stripped.right);
    return identifierName(right) ?? extractFallbackIdentifierName(right);
  }

  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return identifierName(stripParenExpression(stripped.alternate));
  }

  return null;
};

// The fallback identifier name reachable from a key expression, including
// inside a template literal (`` `order-${token ?? index}` ``).
const findFallbackIdentifierNameInKey = (keyExpression: EsTreeNode): string | null => {
  const stripped = stripParenExpression(keyExpression);
  if (isNodeOfType(stripped, "TemplateLiteral")) {
    for (const expression of stripped.expressions ?? []) {
      const name = extractFallbackIdentifierName(expression);
      if (name) return name;
    }
    return null;
  }
  return extractFallbackIdentifierName(stripped);
};

// Walks up to the innermost enclosing iterator callback (`.map`/`.flatMap`/
// `.forEach`) and returns the name of its index (second) parameter, bailing
// at any other function boundary so a coincidentally-named value in an outer
// scope is never matched.
const findIteratorIndexParameterName = (node: EsTreeNode): string | null => {
  let current = node;
  while (current.parent) {
    if (isFunctionLike(current)) {
      const parent = current.parent;
      const isIteratorCallback =
        isNodeOfType(parent, "CallExpression") &&
        parent.arguments.includes(current as never) &&
        isNodeOfType(parent.callee, "MemberExpression") &&
        isNodeOfType(parent.callee.property, "Identifier") &&
        ITERATOR_METHOD_NAMES.has(parent.callee.property.name);
      if (!isIteratorCallback) return null;
      const indexParameter = (current as EsTreeNodeOfType<"ArrowFunctionExpression">).params?.[1];
      if (indexParameter && isNodeOfType(indexParameter, "Identifier")) return indexParameter.name;
      return null;
    }
    current = current.parent;
  }
  return null;
};

export const keyFallbackToIndex = defineRule({
  id: "key-fallback-to-index",
  title: "List key falls back to the array index",
  severity: "warn",
  recommendation:
    "A `key={item.id ?? index}` silently becomes the positional index exactly when the id is missing, so give each item its own stable unique id instead of falling back to the array index.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "key") return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const fallbackName = findFallbackIdentifierNameInKey(node.value.expression);
      if (!fallbackName || !INDEX_PARAMETER_NAMES.has(fallbackName)) return;

      const indexParameterName = findIteratorIndexParameterName(node);
      if (indexParameterName !== fallbackName) return;

      context.report({
        node,
        message: `This key falls back to the array index "${fallbackName}" whenever the id is missing, so two items with no id collapse to the same key and React reuses the wrong row's DOM and state after a reorder — give each item its own stable unique id.`,
      });
    },
  }),
});
