import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isPermanentWillChangeClass = (token: string): boolean => {
  const utility = token.startsWith("!") ? token.slice(1) : token;
  if (utility.includes(":")) return false;
  if (
    utility === "will-change-auto" ||
    utility === "will-change-scroll" ||
    utility === "will-change-[auto]" ||
    utility === "will-change-[scroll-position]"
  ) {
    return false;
  }
  return utility.startsWith("will-change-");
};

export const noPermanentWillChange = defineRule({
  id: "no-permanent-will-change",
  title: "Permanent will-change wastes GPU",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Add will-change when the animation starts (`onMouseEnter`) and remove it when it ends (`onAnimationEnd`). Leaving it on all the time wastes GPU memory and can slow things down",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (node.name.name === "className" || node.name.name === "class") {
        const className = getStringLiteralAttributeValue(node);
        const permanentUtility = className
          ?.split(/\s+/)
          .find((token) => isPermanentWillChangeClass(token));
        if (!permanentUtility) return;
        context.report({
          node,
          message: `This keeps ${permanentUtility} active permanently, which can waste GPU memory. Apply the hint only immediately before the animation and remove it afterward.`,
        });
        return;
      }
      if (node.name.name !== "style") return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const expression = node.value.expression;
      if (!isNodeOfType(expression, "ObjectExpression")) return;

      for (const property of expression.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        const key = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
        if (key !== "willChange") continue;

        // `willChange: isDragging ? "transform" : "auto"` — a conditional or
        // logical value already scopes the hint to the active animation,
        // which is exactly the recommended fix. Only static values are
        // permanent promotions.
        const value = property.value;
        if (
          isNodeOfType(value, "ConditionalExpression") ||
          isNodeOfType(value, "LogicalExpression")
        ) {
          continue;
        }

        // `willChange: "scroll-position"` on a scroll container: there is
        // no pre-scroll event to toggle the hint on, so permanence is the
        // intended usage of that value.
        if (
          isNodeOfType(value, "Literal") &&
          typeof value.value === "string" &&
          value.value.trim() === "scroll-position"
        ) {
          continue;
        }

        context.report({
          node: property,
          message:
            "This wastes GPU memory because will-change is left on all the time, so add it right before the animation & remove it when the animation ends",
        });
      }
    },
  }),
});
