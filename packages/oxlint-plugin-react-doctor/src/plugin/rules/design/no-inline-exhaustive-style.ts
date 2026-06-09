import { INLINE_STYLE_PROPERTY_THRESHOLD } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noInlineExhaustiveStyle = defineRule<Rule>({
  id: "no-inline-exhaustive-style",
  title: "Large inline style object rebuilds every render",
  severity: "warn",
  tags: ["test-noise", "react-jsx-only"],
  recommendation:
    "Move the styles to a CSS class, CSS module, Tailwind utilities, or a styled component. Big inline objects are hard to read and rebuild on every update.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      const propertyCount =
        expression.properties?.filter((property: EsTreeNode) => isNodeOfType(property, "Property"))
          .length ?? 0;

      if (propertyCount >= INLINE_STYLE_PROPERTY_THRESHOLD) {
        context.report({
          node: expression,
          message: `This inline style has ${propertyCount} properties, which is hard to read & rebuilds every render. Move it to a CSS class, CSS module, or styled component.`,
        });
      }
    },
  }),
});
