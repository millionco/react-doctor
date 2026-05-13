import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// HACK: setting React state inside an onScroll handler triggers a re-render
// at scroll-event frequency (60-120Hz). Use a Reanimated shared value
// (useSharedValue + useAnimatedScrollHandler) or a ref + raf throttle so
// the JS thread isn't pegged.
export const rnNoScrollState = defineRule<Rule>({
  recommendation:
    "Track scroll position with a Reanimated shared value (`useAnimatedScrollHandler`) or a ref — `setState` on every scroll event causes re-render storms",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier") return;
      if (node.name.name !== "onScroll") return;
      if (node.value?.type !== "JSXExpressionContainer") return;
      const expression = node.value.expression;
      if (
        expression?.type !== "ArrowFunctionExpression" &&
        expression?.type !== "FunctionExpression"
      ) {
        return;
      }

      let setStateCallNode: EsTreeNode | null = null;
      walkAst(expression.body, (child: EsTreeNode) => {
        if (setStateCallNode) return;
        if (
          child.type === "CallExpression" &&
          child.callee?.type === "Identifier" &&
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
