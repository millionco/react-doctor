import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: setting React state inside an onScroll handler triggers a re-render
// at scroll-event frequency (60-120Hz). Use a Reanimated shared value
// (useSharedValue + useAnimatedScrollHandler) or a ref + raf throttle so
// the JS thread isn't pegged.
export const rnNoScrollState = defineRule<Rule>({
  requires: ["react-native"],
  framework: "react-native",
  severity: "error",
  category: "React Native",
  recommendation:
    "Track scroll position with a Reanimated shared value (`useAnimatedScrollHandler`) or a ref — `setState` on every scroll event causes re-render storms",
  examples: [
    {
      before: "<ScrollView onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)} />",
      after:
        "const scrollY = useSharedValue(0);\nconst handler = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });\n<Animated.ScrollView onScroll={handler} />",
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (node.name.name !== "onScroll") return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
      const expression = node.value.expression;
      if (
        !isNodeOfType(expression, "ArrowFunctionExpression") &&
        !isNodeOfType(expression, "FunctionExpression")
      ) {
        return;
      }

      let setStateCallNode: EsTreeNode | null = null;
      walkAst(expression.body, (child: EsTreeNode) => {
        if (setStateCallNode) return;
        if (
          isNodeOfType(child, "CallExpression") &&
          isNodeOfType(child.callee, "Identifier") &&
          /^set[A-Z]/.test(child.callee.name)
        ) {
          setStateCallNode = child;
        }
      });

      if (setStateCallNode) {
        context.report({
          node: setStateCallNode,
          message:
            "setState in onScroll triggers re-renders on every scroll event — use a Reanimated shared value (useAnimatedScrollHandler) or a ref to track scroll position",
        });
      }
    },
  }),
});
