import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isConstDeclaredBinding } from "../../utils/is-const-declared-binding.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { SCROLLVIEW_NAMES } from "./utils/scrollview_names.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const STATIC_ARITHMETIC_OPERATORS = new Set(["+", "-", "*", "/"]);

// Caps identifier→initializer resolution so a (malformed) cyclic
// `const a = b; const b = a;` chain can't recurse forever.
const STATIC_VALUE_RESOLUTION_MAX_DEPTH = 8;

// A value is "static" when it can't change between renders: any literal
// (`16`, `"10%"`), an expression-free template literal, unary minus /
// arithmetic over static values (`BASE + 8`), or an identifier bound by a
// `const` declaration whose initializer is itself static
// (`const EXTRA = TAB_BAR_HEIGHT + 8`). `let` / `var` bindings can be
// reassigned after declaration, and state / hook / prop values
// (keyboardHeight, insets.bottom) never resolve to a static initializer,
// so all of those still fire.
const isStaticStyleValue = (value: EsTreeNode, resolutionDepth = 0): boolean => {
  if (resolutionDepth > STATIC_VALUE_RESOLUTION_MAX_DEPTH) return false;
  if (isNodeOfType(value, "Literal")) return true;
  if (isNodeOfType(value, "TemplateLiteral")) {
    return getStaticTemplateLiteralValue(value) !== null;
  }
  if (isNodeOfType(value, "UnaryExpression") && value.operator === "-") {
    return isStaticStyleValue(value.argument, resolutionDepth + 1);
  }
  if (isNodeOfType(value, "BinaryExpression") && STATIC_ARITHMETIC_OPERATORS.has(value.operator)) {
    return (
      isStaticStyleValue(value.left, resolutionDepth + 1) &&
      isStaticStyleValue(value.right, resolutionDepth + 1)
    );
  }
  if (!isNodeOfType(value, "Identifier")) return false;
  const binding = findVariableInitializer(value, value.name);
  if (!binding?.initializer || !isConstDeclaredBinding(binding)) return false;
  return isStaticStyleValue(binding.initializer, resolutionDepth + 1);
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
      if (!SCROLLVIEW_NAMES.has(elementName) && elementName !== "FlashList") return;
      if (elementName === "KeyboardAwareScrollView") return;

      for (const attr of node.attributes ?? []) {
        if (!isNodeOfType(attr, "JSXAttribute")) continue;
        if (!isNodeOfType(attr.name, "JSXIdentifier") || attr.name.name !== "contentContainerStyle")
          continue;
        if (!isNodeOfType(attr.value, "JSXExpressionContainer")) continue;
        const expression = attr.value.expression;
        if (!isNodeOfType(expression, "ObjectExpression")) continue;

        for (const property of expression.properties ?? []) {
          if (!isNodeOfType(property, "Property")) continue;
          if (!isNodeOfType(property.key, "Identifier")) continue;
          const key = property.key.name;
          if (key !== "paddingBottom" && key !== "paddingTop") continue;
          // Static value is fine — only flag dynamic identifiers /
          // member expressions that change between renders.
          const value = property.value;
          if (!value) continue;
          if (isStaticStyleValue(value)) continue;

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
