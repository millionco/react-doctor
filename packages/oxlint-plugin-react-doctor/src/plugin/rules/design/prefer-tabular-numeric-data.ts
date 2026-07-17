import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const NUMERIC_FORMAT_METHODS = new Set([
  "toExponential",
  "toFixed",
  "toLocaleString",
  "toPrecision",
]);
const NUMERIC_FORMAT_FUNCTION_PATTERN =
  /^(?:format)?(?:amount|currency|money|number|percent|price|score|total)$/i;

const isNumericFormattingExpression = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) return NUMERIC_FORMAT_FUNCTION_PATTERN.test(callee.name);
  return Boolean(
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    NUMERIC_FORMAT_METHODS.has(callee.property.name),
  );
};

const hasInheritedTabularNumerals = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  let ancestor: EsTreeNode | null | undefined = node;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const classNameValue = getStringFromClassNameAttr(ancestor.openingElement);
      if (classNameValue) {
        const tokens = getUnvariantClassNameTokens(classNameValue);
        if (tokens.includes("tabular-nums") || tokens.includes("font-mono")) return true;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const preferTabularNumericData = defineRule({
  id: "prefer-tabular-numeric-data",
  title: "Changing table numbers use proportional figures",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Apply `tabular-nums` to dynamic numeric columns so digits keep a stable width and align while values change.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        node.openingElement.name.name !== "td" ||
        hasInheritedTabularNumerals(node)
      ) {
        return;
      }
      const hasDynamicFormattedNumber = node.children.some(
        (child) =>
          isNodeOfType(child, "JSXExpressionContainer") &&
          isNumericFormattingExpression(child.expression),
      );
      if (!hasDynamicFormattedNumber) return;
      context.report({
        node: node.openingElement,
        message:
          "This table cell renders a changing formatted number with proportional figures. Add `tabular-nums` to the numeric column or an ancestor.",
      });
    },
  }),
});
