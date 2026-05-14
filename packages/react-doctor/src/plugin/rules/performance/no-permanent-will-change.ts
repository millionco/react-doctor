import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noPermanentWillChange = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Add will-change on animation start (`onMouseEnter`) and remove on end (`onAnimationEnd`). Permanent promotion wastes GPU memory and can degrade performance",
  examples: [
    {
      before: "<div style={{ willChange: 'transform' }} />",
      after:
        "const [isHover, setHover] = useState(false);\n<div\n  onMouseEnter={() => setHover(true)}\n  onTransitionEnd={() => setHover(false)}\n  style={{ willChange: isHover ? 'transform' : 'auto' }}\n/>",
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "style") return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const expression = node.value.expression;
      if (!isNodeOfType(expression, "ObjectExpression")) return;

      for (const property of expression.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        const key = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
        if (key !== "willChange") continue;

        context.report({
          node: property,
          message:
            "Permanent will-change wastes GPU memory — apply only during active animation and remove after",
        });
      }
    },
  }),
});
