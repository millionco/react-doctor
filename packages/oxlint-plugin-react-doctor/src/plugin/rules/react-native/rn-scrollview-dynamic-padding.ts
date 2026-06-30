import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { SCROLLVIEW_NAMES } from "./utils/scrollview_names.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isNumericLiteralNode = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal") && typeof node.value === "number")
    return true;
  // `-16` parses as a unary minus over a numeric literal.
  return (
    isNodeOfType(node, "UnaryExpression") &&
    node.operator === "-" &&
    isNodeOfType(node.argument, "Literal") &&
    typeof node.argument.value === "number"
  );
};

// A value is "static" when it can't change between renders: a numeric literal,
// or an identifier that resolves to a module/const numeric constant
// (`const TAB_BAR_HEIGHT = 56`). State / hook / prop values (keyboardHeight,
// insets.bottom) don't resolve to a numeric literal, so they still fire.
const isStaticNumericValue = (value: EsTreeNode): boolean => {
  if (isNumericLiteralNode(value)) return true;
  if (!isNodeOfType(value, "Identifier")) return false;
  const binding = findVariableInitializer(value, value.name);
  return isNumericLiteralNode(binding?.initializer);
};

// HACK: dynamic `paddingBottom`/`paddingTop` on `contentContainerStyle`
// (e.g. `paddingBottom: keyboardHeight`) reflows the entire scroll
// content every time the value changes — the rows visually shift, and
// any sticky headers re-pin. The native equivalent is `contentInset`,
// which the platform applies as an OS-level offset without re-laying out
// the content.
export const rnScrollviewDynamicPadding = defineRule({
  id: "rn-scrollview-dynamic-padding",
  title: "Dynamic padding on contentContainerStyle",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `contentInset={{ bottom: dynamicValue }}` so the OS shifts the content instead of relaying it out, which avoids the jump.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementName = resolveJsxElementName(node);
      if (!elementName) return;
      if (!SCROLLVIEW_NAMES.has(elementName) && elementName !== "FlashList")
        return;
      if (elementName === "KeyboardAwareScrollView") return;

      for (const attr of node.attributes ?? []) {
        if (!isNodeOfType(attr, "JSXAttribute")) continue;
        if (
          !isNodeOfType(attr.name, "JSXIdentifier") ||
          attr.name.name !== "contentContainerStyle"
        )
          continue;
        if (!isNodeOfType(attr.value, "JSXExpressionContainer")) continue;
        const expression = attr.value.expression;
        if (!isNodeOfType(expression, "ObjectExpression")) continue;

        for (const property of expression.properties ?? []) {
          if (!isNodeOfType(property, "Property")) continue;
          if (!isNodeOfType(property.key, "Identifier")) continue;
          const key = property.key.name;
          if (key !== "paddingBottom" && key !== "paddingTop") continue;
          // Static numeric value is fine — only flag dynamic identifiers /
          // member expressions that change between renders.
          const value = property.value;
          if (!value) continue;
          if (isStaticNumericValue(value)) continue;

          context.report({
            node: property,
            message: `Your users see rows jump when a changing ${key} on contentContainerStyle shifts the whole list.`,
          });
          return;
        }
      }
    },
  }),
});
