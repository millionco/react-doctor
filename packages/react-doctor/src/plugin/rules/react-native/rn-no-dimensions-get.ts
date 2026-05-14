import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoDimensionsGet = defineRule<Rule>({
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Use `const { width, height } = useWindowDimensions()` — it updates reactively on rotation and resize",
  examples: [
    {
      before: "const { width } = Dimensions.get('window');",
      after: "const { width } = useWindowDimensions();",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (
        !isNodeOfType(node.callee.object, "Identifier") ||
        node.callee.object.name !== "Dimensions"
      )
        return;

      if (isMemberProperty(node.callee, "get")) {
        context.report({
          node,
          message:
            "Dimensions.get() does not update on screen rotation or resize — use useWindowDimensions() for reactive layout",
        });
      }

      if (isMemberProperty(node.callee, "addEventListener")) {
        context.report({
          node,
          message:
            "Dimensions.addEventListener() was removed in React Native 0.72 — use useWindowDimensions() instead",
        });
      }
    },
  }),
});
