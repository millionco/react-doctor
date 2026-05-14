import { INDEX_PARAMETER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const STRING_COERCION_FUNCTIONS = new Set(["String", "Number"]);

const extractIndexName = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Identifier") && INDEX_PARAMETER_NAMES.has(node.name)) return node.name;

  if (isNodeOfType(node, "TemplateLiteral")) {
    for (const expression of node.expressions ?? []) {
      if (isNodeOfType(expression, "Identifier") && INDEX_PARAMETER_NAMES.has(expression.name)) {
        return expression.name;
      }
    }
  }

  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    INDEX_PARAMETER_NAMES.has(node.callee.object.name) &&
    isNodeOfType(node.callee.property, "Identifier") &&
    node.callee.property.name === "toString"
  )
    return node.callee.object.name;

  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    STRING_COERCION_FUNCTIONS.has(node.callee.name) &&
    isNodeOfType(node.arguments?.[0], "Identifier") &&
    INDEX_PARAMETER_NAMES.has(node.arguments[0].name)
  )
    return node.arguments[0].name;

  if (
    isNodeOfType(node, "BinaryExpression") &&
    node.operator === "+" &&
    ((isNodeOfType(node.left, "Identifier") &&
      INDEX_PARAMETER_NAMES.has(node.left.name) &&
      isNodeOfType(node.right, "Literal") &&
      node.right.value === "") ||
      (isNodeOfType(node.right, "Identifier") &&
        INDEX_PARAMETER_NAMES.has(node.right.name) &&
        isNodeOfType(node.left, "Literal") &&
        node.left.value === ""))
  ) {
    if (isNodeOfType(node.left, "Identifier")) return node.left.name;
    if (isNodeOfType(node.right, "Identifier")) return node.right.name;
    return null;
  }

  return null;
};

const isInsideStaticPlaceholderMap = (node: EsTreeNode): boolean => {
  let current = node;
  while (current.parent) {
    current = current.parent;
    if (
      isNodeOfType(current, "CallExpression") &&
      isNodeOfType(current.callee, "MemberExpression") &&
      isNodeOfType(current.callee.property, "Identifier") &&
      current.callee.property.name === "map"
    ) {
      const receiver = current.callee.object;
      if (isNodeOfType(receiver, "CallExpression")) {
        const callee = receiver.callee;
        if (
          isNodeOfType(callee, "MemberExpression") &&
          isNodeOfType(callee.object, "Identifier") &&
          callee.object.name === "Array" &&
          isNodeOfType(callee.property, "Identifier") &&
          callee.property.name === "from"
        )
          return true;
      }
      if (
        isNodeOfType(receiver, "NewExpression") &&
        isNodeOfType(receiver.callee, "Identifier") &&
        receiver.callee.name === "Array"
      )
        return true;
    }
  }
  return false;
};

export const noArrayIndexAsKey = defineRule<Rule>({
  id: "no-array-index-as-key",
  framework: "global",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Use a stable unique identifier: `key={item.id}` or `key={item.slug}` — index keys break on reorder/filter",
  examples: [
    {
      before: "items.map((item, index) => <Row key={index} item={item} />)",
      after: "items.map((item) => <Row key={item.id} item={item} />)",
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "key") return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const indexName = extractIndexName(node.value.expression);
      if (!indexName) return;
      if (isInsideStaticPlaceholderMap(node)) return;

      context.report({
        node,
        message: `Array index "${indexName}" used as key — causes bugs when list is reordered or filtered`,
      });
    },
  }),
});
